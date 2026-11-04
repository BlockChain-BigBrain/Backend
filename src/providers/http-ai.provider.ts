import { detectAudio } from "../utils/audioFile";
import { isEbml } from "../utils/webmAudio";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { config } from "../config";
import { riskStatus } from "../dto/rights.dto";
import { TrackFiles } from "../utils/trackFiles";
import { AppError } from "../utils/errors";
import { AiVerificationProvider, AiVerificationRequest, AiVerificationResponse, validateAiResult } from "./ai.provider";

export class HttpAiVerificationProvider implements AiVerificationProvider {
  readonly source = "AI";
  private readonly base: string;
  constructor(base = config.aiUrl, private readonly key = config.aiApiKey, private readonly files = new TrackFiles(), private readonly pollMs = 1000) {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !key) throw new Error("Configure AI_API_URL and TRACK_AI_API_KEY");
    this.base = base.replace(/\/$/, "");
  }
  async verify(input: AiVerificationRequest, outer?: AbortSignal): Promise<AiVerificationResponse> {
    const signal = AbortSignal.any([...(outer ? [outer] : []), AbortSignal.timeout(config.verificationTimeoutMs)]);
    const opened = await this.files.open(input.audioPath);
    let bytes: Buffer;
    try {
      if (opened.size > config.maxUploadBytes) throw new AppError(413, "Audio file is too large");
      bytes = await opened.handle.readFile();
    } finally { await opened.handle.close(); }
    if (createHash("sha256").update(bytes).digest("hex") !== input.audioHash) throw new AppError(409, "Audio content changed");
    const request = async (route: string, init: RequestInit = {}) => {
      const res = await fetch(this.base + route, { ...init, headers: { "X-Internal-API-Key": this.key }, redirect: "error", signal });
      if (!res.ok) throw new AppError(502, "AI server rejected the verification request");
      const raw = await res.text();
      if (raw.length > 1024 * 1024) throw new AppError(502, "AI response too large");
      try { return JSON.parse(raw); } catch { throw new AppError(502, "Invalid AI response"); }
    };
    const form = new FormData();
    const mime = isEbml(bytes) ? "audio/webm" : detectAudio(bytes);
    const suffix = mime === "audio/webm" ? "webm" : mime === "audio/mpeg" ? "mp3" : "wav";
    form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), `track-${input.trackId}.${suffix}`);
    form.set("trackId", String(input.trackId)); form.set("requestId", input.requestId ?? `track-${input.trackId}-${input.audioHash}`);
    const accepted = await request("/verify", { method: "POST", body: form });
    if (typeof accepted.jobId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(accepted.jobId)) throw new AppError(502, "Invalid AI job identifier");
    for (;;) {
      const job = await request(`/verify/${encodeURIComponent(accepted.jobId)}`);
      if (job.jobId !== accepted.jobId || job.trackId !== String(input.trackId)) throw new AppError(502, "AI job identity mismatch");
      if (job.state === "SUCCEEDED") return normalizeAiEvidence(job.result, input.audioHash);
      if (job.state === "FAILED") throw new AppError(502, "AI analysis failed");
      if (!["PENDING", "RUNNING"].includes(job.state)) throw new AppError(502, "Invalid AI job state");
      await delay(this.pollMs, undefined, { signal });
    }
  }
}

export function normalizeAiEvidence(raw: any, audioHash: string): AiVerificationResponse {
  const policy = {
    modelVersion: "laion/clap-htsat-unfused",
    scoreVersion: "hybrid_query_top3_pairwise_hold-v5",
    decisionPolicyVersion: "track-ai-balanced-policy-v5-20261102",
    warn: 0.351229127861893,
    hold: 0.9471999941293027,
  } as const;
  if (!raw || raw.audioHash !== audioHash || !["PASS", "WARN", "HOLD", "BLOCK"].includes(raw.decision) || typeof raw.duplicate?.detected !== "boolean" || raw.provisional !== true) throw new AppError(502, "Invalid AI evidence or audio hash mismatch");
  for (const field of ["modelVersion", "scoreVersion", "corpusVersion", "decisionPolicyVersion"]) if (typeof raw[field] !== "string" || !raw[field] || raw[field].length > 191) throw new AppError(502, "Incomplete AI provenance");
  if (raw.modelVersion !== policy.modelVersion || raw.scoreVersion !== policy.scoreVersion || raw.decisionPolicyVersion !== policy.decisionPolicyVersion) throw new AppError(502, "Unsupported AI policy version");
  const { warn, hold } = raw.thresholds ?? {};
  const close = (a: unknown, b: number) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) < 1e-12;
  if (!close(warn, policy.warn) || !close(hold, policy.hold) || !Number.isFinite(raw.processingSeconds) || raw.processingSeconds < 0) throw new AppError(502, "Invalid AI policy evidence");
  const blocked = raw.decision === "BLOCK";
  if (blocked !== raw.duplicate.detected || (blocked && (raw.similarityScore !== null || raw.queryVerifierScore !== null)) || !Array.isArray(raw.similarTracks) || raw.similarTracks.length > 3) throw new AppError(502, "Contradictory AI evidence");
  if (!blocked && [raw.similarityScore, raw.queryVerifierScore].some((n) => typeof n !== "number" || !Number.isFinite(n) || n < -1 || n > 1)) throw new AppError(502, "Invalid AI verifier score");
  if (!blocked) {
    // WARN is query-level; HOLD is pairwise. They are intentionally different score spaces.
    const expected = raw.similarityScore >= hold ? "HOLD" : raw.queryVerifierScore >= warn ? "WARN" : "PASS";
    if (raw.decision !== expected) throw new AppError(502, "AI decision disagrees with its thresholds");
  }
  const expectedReview = ["WARN", "HOLD"].includes(raw.decision);
  const expectedDisposition = blocked ? "AUTO_BLOCK" : expectedReview ? "HUMAN_REVIEW" : "ALLOW";
  const evidence = { ...raw, reviewRequired: expectedReview, disposition: expectedDisposition,
    decisionReason: blocked ? "EXACT_DUPLICATE" : raw.decision === "HOLD" ? "PAIRWISE_TEMPORAL_MATCH" : raw.decision === "WARN" ? "QUERY_LEVEL_MATCH" : "NO_POLICY_THRESHOLD" };
  // The Contract has a fixed 0..10000 score scale. Preserve raw v5 scores in evidence,
  // while mapping the AI decision to a canonical risk band for legacy on-chain fields.
  const bounded = (n: number) => Number(new Prisma.Decimal(Math.max(0, n)).toFixed(4));
  const score = blocked ? 1 : raw.decision === "PASS" ? Math.min(0.7999, bounded(raw.similarityScore)) : raw.decision === "WARN" ? Math.min(0.8499, Math.max(0.8, bounded(raw.similarityScore))) : Math.max(0.85, bounded(raw.similarityScore));
  const similarTracks = raw.similarTracks.map((item: any) => {
    if (typeof item.trackId !== "string" || !item.trackId || item.trackId.length > 191 || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < -1 || item.score > 1 || !Array.isArray(item.matchedSegments)) throw new AppError(502, "Invalid external corpus match");
    for (const segment of item.matchedSegments) for (const field of ["queryStartSec", "queryEndSec", "refStartSec", "refEndSec", "score"]) if (segment[field] !== undefined && (typeof segment[field] !== "number" || !Number.isFinite(segment[field]))) throw new AppError(502, "Invalid matched segment");
    return { externalTrackId: item.trackId, score: bounded(item.score) };
  });
  return validateAiResult({ duplicate: blocked, riskScore: score, status: riskStatus(score), modelVersion: raw.modelVersion, similarTracks, evidence });
}

export function aiRequiresReview(evidence: Prisma.JsonValue | undefined | null): boolean {
  return !!evidence && typeof evidence === "object" && !Array.isArray(evidence) && evidence.reviewRequired === true;
}
