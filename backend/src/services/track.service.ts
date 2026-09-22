import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { ContributionInput, CreateTrackInput } from "../dto/track.dto";
import { TrackRepository } from "../repositories/track.repository";
import { AppError } from "../utils/errors";

export class TrackService {
  constructor(private readonly tracks: TrackRepository, private readonly db: PrismaClient) {}

  async create(ownerId: number, input: CreateTrackInput, file?: Express.Multer.File) {
    if (!input.title?.trim()) throw new AppError(400, "title is required");
    if (!file) throw new AppError(400, "audio file is required");
    const contributors = input.contributors ?? [];
    const total = contributors.reduce((sum: number, item: ContributionInput) => sum + item.percentage, 0);
    if (total > 100) throw new AppError(400, "contribution percentages cannot exceed 100");
    try {
      return await this.tracks.create({
        title: input.title.trim(), prompt: input.prompt, workLog: input.workLog,
        audioPath: `/uploads/${file.filename}`, mimeType: file.mimetype,
        owner: { connect: { id: ownerId } }, contributions: { create: contributors },
      });
    } catch (error) {
      await fs.unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  list() { return this.tracks.findMany(); }
  async get(id: number) {
    const track = await this.tracks.findById(id);
    if (!track) throw new AppError(404, "Track not found");
    return track;
  }
  async remove(id: number) {
    const track = await this.get(id);
    await this.tracks.delete(id);
    await fs.unlink(`.${track.audioPath}`).catch(() => undefined);
  }
  verify(id: number) {
    return this.db.verification.create({ data: { trackId: id, status: "PENDING", message: "Verification requested" } });
  }
}