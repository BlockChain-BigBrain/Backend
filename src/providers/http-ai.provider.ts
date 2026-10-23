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
    form.set("file", new Blob([new Uint8Array(bytes)]), input.audioPath.split("/").pop()!);
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
  if (!raw || raw.audioHash !== audioHash || !["PASS", "WARN", "HOLD", "BLOCK"].includes(raw.decision) || typeof raw.duplicate?.detected !== "boolean" || typeof raw.reviewRequired !== "boolean" || typeof raw.provisional !== "boolean") throw new AppError(502, "Invalid AI evidence or audio hash mismatch");
  for (const field of ["modelVersion", "scoreVersion", "corpusVersion", "decisionPolicyVersion", "decisionReason", "disposition"]) if (typeof raw[field] !== "string" || !raw[field] || raw[field].length > 191) throw new AppError(502, "Incomplete AI provenance");
  const { warn, hold } = raw.thresholds ?? {};
  if (!Number.isFinite(warn) || !Number.isFinite(hold) || warn < 0 || warn >= hold || hold > 1 || !Number.isFinite(raw.processingSeconds) || raw.processingSeconds < 0) throw new AppError(502, "Invalid AI policy evidence");
  const blocked = raw.decision === "BLOCK";
  if (blocked !== raw.duplicate.detected || (blocked && raw.similarityScore !== null) || !Array.isArray(raw.similarTracks) || raw.similarTracks.length > 3) throw new AppError(502, "Contradictory AI evidence");
  if (!blocked && (typeof raw.similarityScore !== "number" || raw.similarityScore < -1 || raw.similarityScore > 1)) throw new AppError(502, "Invalid raw similarity score");
  if (!blocked) {
    const expected = raw.similarityScore >= hold ? "HOLD" : raw.similarityScore >= warn ? "WARN" : "PASS";
    if (raw.decision !== expected) throw new AppError(502, "AI decision disagrees with its thresholds");
  }
  const expectedReview = ["WARN", "HOLD"].includes(raw.decision);
  const expectedDisposition = blocked ? "AUTO_BLOCK" : expectedReview ? "HUMAN_REVIEW" : "ALLOW";
  if (raw.reviewRequired !== expectedReview || raw.disposition !== expectedDisposition) throw new AppError(502, "Invalid AI review disposition");
  // The contract has a fixed 0..10000 score scale. Keep original scores and the
  // evaluated AI policy separately; never silently reinterpret a HOLD as WARN.
  const bounded = (n: number) => Number(new Prisma.Decimal(Math.max(0, n)).toFixed(4));
  const score = blocked ? 1 : bounded(raw.similarityScore);
  const similarTracks = raw.similarTracks.map((item: any) => {
    if (typeof item.trackId !== "string" || !item.trackId || item.trackId.length > 191 || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < -1 || item.score > 1 || !Array.isArray(item.matchedSegments)) throw new AppError(502, "Invalid external corpus match");
    return { externalTrackId: item.trackId, score: bounded(item.score) };
  });
  return validateAiResult({ duplicate: blocked, riskScore: score, status: riskStatus(score), modelVersion: raw.modelVersion, similarTracks, evidence: raw });
}

export function aiRequiresReview(evidence: Prisma.JsonValue | undefined | null): boolean {
  return !!evidence && typeof evidence === "object" && !Array.isArray(evidence) && evidence.reviewRequired === true;
}
