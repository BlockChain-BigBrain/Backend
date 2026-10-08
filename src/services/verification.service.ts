import { Prisma } from "@prisma/client";
import { AiVerificationProvider, AiVerificationRequest, validateAiResult } from "../providers/ai.provider";
import { config } from "../config";
import { own, RightsRepository } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";

export class VerificationService {
  constructor(private readonly repo: RightsRepository, private readonly provider: AiVerificationProvider, private readonly timeoutMs = config.verificationTimeoutMs) {}
  async request(id: number, userId: number, reverify = false) {
    const pending = await this.repo.locked(id, async (tx, track) => {
      own(track, userId);
      if (track.registrationStatus === "PENDING") throw new AppError(409, "Registration is pending");
      if (!track.audioHash) throw new AppError(409, "Audio hash is required; re-upload legacy audio");
      const stale = track.verifications.filter(item => item.status === "PENDING" && item.updatedAt.getTime() <= Date.now() - this.timeoutMs);
      if (stale.length) await tx.verification.updateMany({ where: { id: { in: stale.map(item => item.id) }, status: "PENDING" }, data: { status: "REJECTED", errorCode: "STALE_PENDING", errorMessage: "An interrupted verification request expired" } });
      if (track.verifications.some(item => item.status === "PENDING" && !stale.some(expired => expired.id === item.id))) throw new AppError(409, "Verification is already pending");
      if (!reverify && track.verifications.some(item => item.status === "VERIFIED")) throw new AppError(409, "Use reverify for an already verified track");
      await tx.marketplaceListing.updateMany({ where: { trackId: id, status: "ACTIVE" }, data: { status: "PREPARING", activeTrackId: null } });
      return { record: await tx.verification.create({ data: { trackId: id, source: this.provider.source, status: "PENDING" } }), audioHash: track.audioHash, audioPath: track.audioPath };
    });
    try {
      const result = validateAiResult(await verificationWithTimeout(this.provider, { trackId: id, audioHash: pending.audioHash, audioPath: pending.audioPath }, this.timeoutMs));
      if (this.provider.source === "UNCONFIGURED") throw new AppError(503, "AI provider is not configured");
      await this.repo.locked(id, async (tx, track) => {
        const record = await tx.verification.findUniqueOrThrow({ where: { id: pending.record.id } });
        if (record.status !== "PENDING" || track.audioHash !== pending.audioHash) throw new AppError(409, "Verification input changed");
        for (const item of result.similarTracks) if (item.trackId && (item.trackId === id || !await tx.track.findUnique({ where: { id: item.trackId }, select: { id: true } }))) throw new AppError(502, "Invalid internal comparison track");
        await tx.verification.update({ where: { id: record.id }, data: {
          duplicate: result.duplicate, riskScore: new Prisma.Decimal(result.riskScore), riskStatus: result.status,
          modelVersion: result.modelVersion, status: "VERIFIED", verifiedAt: new Date(),
          similarityResults: { create: result.similarTracks.map(item => ({ trackId: id, comparedTrackId: item.trackId, comparedUrl: item.url, score: new Prisma.Decimal(item.score) })) },
        } });
        // Any changed verdict immediately removes a listing from real public sale.
        await tx.marketplaceListing.updateMany({ where: { trackId: id, status: "ACTIVE" }, data: { status: "PREPARING", activeTrackId: null } });
      });
    } catch (error) {
      await this.repo.db.$transaction(async tx => {
        await tx.verification.updateMany({ where: { id: pending.record.id, status: "PENDING" }, data: { status: "REJECTED", errorCode: this.provider.source === "UNCONFIGURED" ? "AI_NOT_CONFIGURED" : error instanceof AppError && error.message === "AI verification timed out" ? "AI_TIMEOUT" : "AI_ANALYSIS_FAILED", errorMessage: "Verification provider failed or returned invalid data" } });
        await tx.marketplaceListing.updateMany({ where: { trackId: id, status: "ACTIVE" }, data: { status: "PREPARING", activeTrackId: null } });
      });
    }
    return this.repo.db.verification.findUniqueOrThrow({ where: { id: pending.record.id }, include: { similarityResults: { orderBy: { score: "desc" } } } });
  }
  async latest(id: number, userId?: number) {
    const track = await this.repo.track(id, userId);
    const result = track.verifications[0];
    if (!result) throw new AppError(404, "Verification not found");
    return this.publicResult(result, track.ownerId === userId);
  }
  async history(id: number, userId: number) { return (await this.repo.track(id, userId, true)).verifications; }
  private publicResult<T extends { fingerprint: string | null; message: string | null; errorMessage: string | null }>(result: T, owner: boolean) {
    if (owner) return result;
    const { fingerprint: _fingerprint, message: _message, errorMessage: _errorMessage, ...safe } = result;
    return safe;
  }
}

export async function verificationWithTimeout(provider: AiVerificationProvider, request: AiVerificationRequest, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.verify(request, controller.signal),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AppError(503, "AI verification timed out")); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
