import { Prisma, PrismaClient, Track } from "@prisma/client";
import { parseCreateTrack, parseTrackList, parseUpdateTrack, trackId } from "../dto/track.dto";
import { TrackDetail, TrackRepository } from "../repositories/track.repository";
import { AppError } from "../utils/errors";
import { TrackFiles } from "../utils/trackFiles";
import { logServerError } from "../utils/errorLogger";

function response<T extends Track>(track: T, userId?: number) {
  return {
    ...track,
    audioPath: `/api/tracks/${track.id}/audio`,
    fileSize: track.fileSize?.toString() ?? null,
    ...(userId === track.ownerId ? {} : { prompt: null, workLog: null }),
    ...("verifications" in track && userId !== track.ownerId ? {
      verifications: (track as T & Pick<TrackDetail, "verifications">).verifications.map(({ fingerprint: _fingerprint, errorMessage: _error, message: _message, ...safe }) => safe),
    } : {}),
  };
}
function owner(track: Track, userId: number) {
  if (track.ownerId !== userId) throw new AppError(403, "Only the track owner may perform this action");
}
function editable(track: Track) {
  if (["PENDING", "REGISTERED"].includes(track.registrationStatus) || track.registrationTxHash || track.blockchainTrackId) throw new AppError(409, "Registered tracks or pending registrations cannot be modified or deleted");
}
function translate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") throw new AppError(409, "Track is referenced by other records or a contributor does not exist");
    if (error.code === "P2002") throw new AppError(409, "Duplicate track data");
    if (error.code === "P2025") throw new AppError(404, "Track not found");
    if (error.code === "P2034") throw new AppError(409, "Concurrent change; retry the request");
  }
  throw error;
}
export class TrackService {
  constructor(private readonly tracks: TrackRepository, private readonly db: PrismaClient, private readonly files = new TrackFiles()) {}
  async create(ownerId: number, value: unknown, file?: Express.Multer.File) {
    try {
      const input = parseCreateTrack(value);
      if (!file) throw new AppError(400, "audio file is required");
      const audio = await this.files.inspect(file);
      const userIds = [...new Set((input.contributors ?? []).map(item => item.userId))];
      if (userIds.length && await this.db.user.count({ where: { id: { in: userIds } } }) !== userIds.length) throw new AppError(400, "Contributor does not exist");
      const { contributors, ...data } = input;
      const created = await this.tracks.create({ ...data, ...audio, owner: { connect: { id: ownerId } }, contributions: { create: contributors } });
      return response(created, ownerId);
    } catch (error) {
      await this.files.cleanupAfterFailure(file);
      translate(error);
    }
  }
  async list(value: unknown = {}, userId?: number) {
    const query = parseTrackList(value);
    if (query.scope === "mine" && !userId) throw new AppError(401, "Authentication is required for your tracks");
    const result = await this.tracks.findMany(query, userId);
    return { items: result.items.map(track => response(track, userId)), total: result.total, page: query.page, limit: query.limit };
  }
  private async readable(id: number, userId?: number) {
    const track = await this.tracks.findById(trackId(id));
    if (!track || (!track.isPublic && track.ownerId !== userId)) throw new AppError(404, "Track not found");
    return track;
  }
  async get(id: number, userId?: number) { return response(await this.readable(id, userId), userId); }
  async update(id: number, userId: number, value: unknown) {
    const data = parseUpdateTrack(value);
    try {
      return await this.tracks.withLockedTrack(trackId(id), async (tx, track) => {
        owner(track, userId); editable(track);
        return response(await this.tracks.update(tx, id, data), userId);
      });
    } catch (error) { translate(error); }
  }
  async remove(id: number, userId: number) {
    const deletion: { staged?: NonNullable<Awaited<ReturnType<TrackFiles["stageDelete"]>>> } = {};
    try {
      await this.tracks.withLockedTrack(trackId(id), async (tx, track) => {
        owner(track, userId); editable(track);
        deletion.staged = await this.files.stageDelete(track.audioPath);
        await this.tracks.delete(tx, id);
      });
    } catch (error) {
      if (deletion.staged) {
        try { await deletion.staged.restore(); } catch (restoreError) { logServerError("track_file_restore_failed", restoreError); }
      }
      translate(error);
    }
    if (deletion.staged) {
      // An inaccessible .delete-* file may remain if filesystem cleanup fails after commit.
      try { await deletion.staged.finish(); } catch (error) { logServerError("track_file_delete_failed", error); }
    }
  }
  async audio(id: number, userId?: number) {
    const track = await this.readable(id, userId);
    const opened = await this.files.open(track.audioPath);
    const mimeType = ["audio/mpeg", "audio/mp3"].includes(track.mimeType) ? "audio/mpeg" : ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(track.mimeType) ? "audio/wav" : undefined;
    if (!mimeType) { await opened.handle.close(); throw new AppError(415, "Only MP3 and WAV playback is supported"); }
    return { ...opened, mimeType, id: track.id };
  }
  // Existing request-only functionality is retained; AI integration belongs to the next feature.
  async verify(id: number, userId: number) {
    try {
      return await this.tracks.withLockedTrack(trackId(id), async (tx, track) => {
        owner(track, userId);
        return tx.verification.create({ data: { trackId: id, status: "PENDING", message: "Verification requested" } });
      });
    } catch (error) { translate(error); }
  }
}
