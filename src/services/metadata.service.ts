import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { decodeBase58 } from "ethers";
import { config } from "../config";
import { body, flag, riskStatus, wallet } from "../dto/rights.dto";
import { mutable, own, RightsRepository, RightsTrack } from "../repositories/rights.repository";
import { StorageProvider, StorageUploadResult } from "../providers/storage.provider";
import { creatorShares } from "./contribution.service";
import { AppError } from "../utils/errors";

export function metadataDocument(track: RightsTrack, options: unknown = {}) {
  const input = body(options, ["publishPrompt", "publishWorkLog", "acceptPublicDisclosure"]);
  const publishPrompt = flag(input.publishPrompt), publishWorkLog = flag(input.publishWorkLog);
  if ((publishPrompt || publishWorkLog) && !flag(input.acceptPublicDisclosure)) throw new AppError(400, "Explicit public disclosure consent is required for prompt/workLog");
  if (!track.audioHash || !/^[a-f0-9]{64}$/.test(track.audioHash)) throw new AppError(409, "Audio hash is required");
  if (!track.contributionsFinalizedAt) throw new AppError(409, "Contributions must be finalized");
  const verification = track.verifications[0];
  if (!verification || verification.status !== "VERIFIED" || verification.riskScore === null || !verification.riskStatus || !verification.modelVersion) throw new AppError(409, "Completed verification is required");
  const document = {
    schemaVersion: "1.0", title: track.title, audioHash: track.audioHash, creator: wallet(track.owner.walletAddress),
    contributors: creatorShares(track).map(item => ({ wallet: item.walletAddress!, percentage: item.percentage })),
    ...(publishPrompt ? { prompt: track.prompt } : {}), ...(publishWorkLog ? { workLog: track.workLog } : {}),
    verification: { id: verification.id, source: verification.source, duplicate: verification.duplicate, riskScore: verification.riskScore.toNumber(), status: verification.riskStatus, modelVersion: verification.modelVersion },
    disclosure: { prompt: publishPrompt, workLog: publishWorkLog },
  };
  validateMetadata(document);
  return document;
}
export function validateMetadata(document: ReturnType<typeof metadataDocument>): void {
  if (!document.title || !/^[a-f0-9]{64}$/.test(document.audioHash) || document.schemaVersion !== "1.0" || !Array.isArray(document.contributors) || !document.contributors.length) throw new AppError(400, "Invalid metadata schema");
  if (!document.verification || !["AI", "MOCK"].includes(document.verification.source) || typeof document.verification.duplicate !== "boolean" || !document.verification.modelVersion || riskStatus(document.verification.riskScore) !== document.verification.status) throw new AppError(400, "Invalid metadata verification");
  wallet(document.creator);
  let total = new Prisma.Decimal(0);
  for (const item of document.contributors) {
    wallet(item.wallet); const share = new Prisma.Decimal(item.percentage);
    if (share.lte(0) || share.gt(100)) throw new AppError(400, "Invalid metadata contribution"); total = total.plus(share);
  }
  if (!total.eq(100)) throw new AppError(400, "Invalid metadata contribution total");
}
export function snapshotMatchesTrack(track: RightsTrack): boolean {
  const latest = track.metadataSnapshots[0];
  if (!latest || !latest.document || typeof latest.document !== "object" || Array.isArray(latest.document)) return false;
  const disclosure = (latest.document as { disclosure?: { prompt?: boolean; workLog?: boolean } }).disclosure;
  try {
    const current = metadataDocument(track, { publishPrompt: disclosure?.prompt ?? false, publishWorkLog: disclosure?.workLog ?? false, acceptPublicDisclosure: true });
    return createHash("sha256").update(JSON.stringify(current)).digest("hex") === latest.hash;
  } catch { return false; }
}
export function cidBytes(value: unknown): Buffer | undefined {
  if (typeof value !== "string") return undefined;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) {
    try { const hex = decodeBase58(value).toString(16); return hex.length === 68 && hex.startsWith("1220") ? Buffer.from(hex, "hex") : undefined; } catch { return undefined; }
  }
  if (!/^b[a-z2-7]{20,254}$/.test(value)) return undefined;
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes: number[] = []; let bits = 0, accumulator = 0;
  for (const char of value.slice(1)) {
    accumulator = (accumulator << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); accumulator &= (1 << bits) - 1; }
  }
  if (accumulator !== 0) return undefined;
  let offset = 0;
  const varint = () => {
    let result = 0, shift = 0;
    while (offset < bytes.length && shift <= 28) { const byte = bytes[offset++]; result += (byte & 127) * 2 ** shift; if (!(byte & 128)) return result; shift += 7; }
    return -1;
  };
  const version = varint(), codec = varint(), hashCode = varint(), digestLength = varint();
  return version === 1 && codec > 0 && hashCode >= 0 && digestLength > 0 && digestLength <= 64 && bytes.length - offset === digestLength ? Buffer.from(bytes) : undefined;
}
export function validCid(value: unknown): value is string { return !!cidBytes(value); }
export class MetadataService {
  readonly root: string;
  constructor(private readonly repo: RightsRepository, private readonly storage: StorageProvider, root = config.metadataDir) { this.root = path.resolve(root); }
  async preview(id: number, userId: number, options: unknown = {}) { return metadataDocument(await this.repo.track(id, userId, true), options); }
  async prepare(id: number, userId: number, options: unknown = {}) {
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId); mutable(track);
      const document = metadataDocument(track, options);
      const content = JSON.stringify(document), hash = createHash("sha256").update(content).digest("hex");
      const latest = track.metadataSnapshots[0];
      const finalPath = path.join(this.root, `${id}-${hash}.json`), temporary = `${finalPath}.${randomUUID()}.tmp`;
      let failed = false;
      try {
        await fs.mkdir(this.root, { recursive: true });
        await fs.writeFile(temporary, content, { flag: "wx", mode: 0o600 }); await fs.rename(temporary, finalPath);
      } catch { failed = true; }
      finally { await fs.unlink(temporary).catch(() => undefined); }
      const failure = { errorCode: failed ? "LOCAL_METADATA_FAILED" : null, errorMessage: failed ? "Local metadata file could not be prepared" : null };
      const snapshot = latest?.hash === hash
        ? await tx.metadataSnapshot.update({ where: { id: latest.id }, data: { ...failure, status: failed ? "FAILED" : latest.status === "UPLOADED" ? "UPLOADED" : "PREPARED" } })
        : await tx.metadataSnapshot.create({ data: { trackId: id, version: (latest?.version ?? 0) + 1, hash, document: document as Prisma.InputJsonValue, status: failed ? "FAILED" : "PREPARED", ...failure } });
      if (latest?.hash !== hash || failed) await tx.track.update({ where: { id }, data: { metadataCid: null, audioCid: null } });
      return { ...snapshot, localReady: !failed };
    });
  }
  async status(id: number, userId: number) {
    const track = await this.repo.track(id, userId, true);
    return { configured: this.storage.configured, metadataCid: track.metadataCid, audioCid: track.audioCid, snapshot: track.metadataSnapshots[0] ?? null };
  }
  // Trusted adapter/worker boundary. No endpoint accepts a client supplied CID.
  async upload(id: number, userId: number) {
    const track = await this.repo.track(id, userId, true), snapshot = track.metadataSnapshots[0];
    if (!snapshot || !track.audioHash || !snapshotMatchesTrack(track)) throw new AppError(409, "Prepare current metadata first");
    const request = { trackId: id, metadataHash: snapshot.hash, metadata: snapshot.document, audioPath: track.audioPath, audioHash: track.audioHash };
    try {
      const result = await this.storage.upload(request);
      if (!await this.storage.verify(request, result)) throw new AppError(502, "Storage provider could not verify uploaded content");
      return await this.acceptUpload(id, userId, snapshot.id, result);
    } catch (error) {
      await this.repo.db.metadataSnapshot.update({ where: { id: snapshot.id }, data: { status: "FAILED", errorCode: "IPFS_UPLOAD_FAILED", errorMessage: "Storage upload or verification failed" } });
      throw error;
    }
  }
  private async acceptUpload(id: number, userId: number, snapshotId: number, result: StorageUploadResult) {
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId); mutable(track);
      const latest = track.metadataSnapshots[0];
      if (!latest || latest.id !== snapshotId || latest.hash !== result.metadataHash || !snapshotMatchesTrack(track) || result.source !== "REAL" || !validCid(result.metadataCid) || (result.audioCid !== undefined && !validCid(result.audioCid))) throw new AppError(409, "Invalid or stale upload result");
      await tx.track.update({ where: { id }, data: { metadataCid: result.metadataCid, audioCid: result.audioCid ?? null } });
      return tx.metadataSnapshot.update({ where: { id: latest.id }, data: { status: "UPLOADED", metadataCid: result.metadataCid, audioCid: result.audioCid, errorCode: null, errorMessage: null } });
    });
  }
}
