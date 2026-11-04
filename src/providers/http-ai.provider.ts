import { detectAudio } from "../utils/audioFile";
import { isEbml } from "../utils/webmAudio";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { config } from "../config";
import { TrackFiles } from "../utils/trackFiles";
import { AiProviderError } from "./ai.errors";
import { AiVerificationProvider, AiVerificationRequest, AiVerificationResponse, validateAiResult } from "./ai.provider";

export class HttpAiVerificationProvider implements AiVerificationProvider {
  readonly source = "AI";
  private readonly base: string;
  constructor(base = config.aiUrl, private readonly key = config.aiApiKey, private readonly files = new TrackFiles(), private readonly pollMs = 1000) {
    this.base = base.replace(/\/$/, "");
  }
  async verify(input: AiVerificationRequest, outer?: AbortSignal): Promise<AiVerificationResponse> {
    // App startup does not need AI credentials; verification must fail closed.
    try {
      const url = new URL(this.base);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !this.key.trim() || /[\s\x00-\x1f\x7f]/.test(this.key)) throw new Error();
    } catch {
      throw new AiProviderError("AI_NOT_CONFIGURED", "configuration", 503);
    }
    const signal = AbortSignal.any([...(outer ? [outer] : []), AbortSignal.timeout(config.verificationTimeoutMs)]);
    let opened;
    try { opened = await this.files.open(input.audioPath); }
    catch { throw new AiProviderError("AI_AUDIO_READ_FAILED", "audio"); }
    let bytes: Buffer;
    try {
      if (opened.size > config.maxUploadBytes) throw new AiProviderError("AI_AUDIO_READ_FAILED", "audio", 413);
      bytes = await opened.handle.readFile();
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError("AI_AUDIO_READ_FAILED", "audio");
    } finally { await opened.handle.close(); }
    if (createHash("sha256").update(bytes).digest("hex") !== input.audioHash) throw new AiProviderError("AI_AUDIO_HASH_MISMATCH", "audio", 409);
    const request = async (route: string, init: RequestInit = {}) => {
      const stage = init.method === "POST" ? "upload" : "poll";
      try {
        const res = await fetch(this.base + route, { ...init, headers: { Authorization: `Bearer ${this.key}` }, redirect: "error", signal });
        if (!res.ok) {
          await res.body?.cancel();
          throw new AiProviderError(res.status === 401 || res.status === 403 ? "AI_AUTH_FAILED" : "AI_HTTP_ERROR", stage, 502, res.status);
        }
        const raw = await res.text();
        if (raw.length > 1024 * 1024) throw new AiProviderError("AI_INVALID_RESPONSE", stage);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { throw new AiProviderError("AI_INVALID_JSON", stage); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AiProviderError("AI_INVALID_RESPONSE", stage);
        return parsed as Record<string, any>;
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (signal.aborted) throw new AiProviderError("AI_TIMEOUT", stage, 503);
        throw new AiProviderError("AI_CONNECTION_FAILED", stage, 503);
      }
    };
    const form = new FormData();
    const mime = isEbml(bytes) ? "audio/webm" : detectAudio(bytes);
    const suffix = mime === "audio/webm" ? "webm" : mime === "audio/mpeg" ? "mp3" : "wav";
    form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), `track-${input.trackId}.${suffix}`);
    form.set("trackId", String(input.trackId)); form.set("requestId", input.requestId ?? `track-${input.trackId}-${input.audioHash}`);
    const accepted = await request("/verify", { method: "POST", body: form });
    if (typeof accepted.jobId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(accepted.jobId)) throw new AiProviderError("AI_INVALID_RESPONSE", "upload");
    for (;;) {
      const job = await request(`/verify/${encodeURIComponent(accepted.jobId)}`);
      if (job.jobId !== accepted.jobId || job.trackId !== String(input.trackId)) throw new AiProviderError("AI_INVALID_RESPONSE", "poll");
      if (job.state === "SUCCEEDED") return normalizeAiEvidence(job.result, input.audioHash);
      if (job.state === "FAILED") throw new AiProviderError("AI_JOB_FAILED", "poll");
      if (!["PENDING", "RUNNING"].includes(job.state)) throw new AiProviderError("AI_INVALID_RESPONSE", "poll");
      try { await delay(this.pollMs, undefined, { signal }); }
      catch { throw new AiProviderError("AI_TIMEOUT", "poll", 503); }
    }
  }
}

export function normalizeAiEvidence(raw: any, audioHash: string): AiVerificationResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AiProviderError("AI_INVALID_RESPONSE", "result");
  if (typeof raw.audioHash !== "string") throw new AiProviderError("AI_INVALID_RESPONSE", "result");
  if (raw.audioHash !== audioHash) throw new AiProviderError("AI_AUDIO_HASH_MISMATCH", "result");
  if (!["PASS", "WARN", "HOLD", "BLOCK"].includes(raw.decision) || typeof raw.duplicate?.detected !== "boolean" || typeof raw.provisional !== "boolean") throw new AiProviderError("AI_INVALID_RESPONSE", "result");
  for (const field of ["modelVersion", "scoreVersion", "corpusVersion", "decisionPolicyVersion"]) if (typeof raw[field] !== "string" || !raw[field] || raw[field].length > 191) throw new AiProviderError("AI_INVALID_RESPONSE", "result");
  const { warn, hold } = raw.thresholds ?? {};
  // v5 WARN and HOLD thresholds belong to different calibrated classifiers.
  if (![warn, hold].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) || !Number.isFinite(raw.processingSeconds) || raw.processingSeconds < 0) throw new AiProviderError("AI_INVALID_RESPONSE", "result");
  const blocked = raw.decision === "BLOCK";
  if (blocked !== raw.duplicate.detected || (blocked && raw.similarityScore !== null) || !Array.isArray(raw.similarTracks) || raw.similarTracks.length > 3) throw new AiProviderError("AI_POLICY_FAILED", "result");
  if (!blocked) {
    if (typeof raw.similarityScore !== "number" || !Number.isFinite(raw.similarityScore) || raw.similarityScore < 0 || raw.similarityScore > 1 || typeof raw.queryVerifierScore !== "number" || !Number.isFinite(raw.queryVerifierScore) || raw.queryVerifierScore < 0 || raw.queryVerifierScore > 1) throw new AiProviderError("AI_INVALID_RESPONSE", "result");
    const expected = raw.similarityScore >= hold ? "HOLD" : raw.queryVerifierScore >= warn ? "WARN" : "PASS";
    if (raw.decision !== expected) throw new AiProviderError("AI_POLICY_FAILED", "result");
  }
  const expectedReview = raw.decision === "WARN" || raw.decision === "HOLD";
  const expectedDisposition = blocked ? "AUTO_BLOCK" : expectedReview ? "HUMAN_REVIEW" : "ALLOW";
  if (raw.reviewRequired !== undefined && raw.reviewRequired !== expectedReview) throw new AiProviderError("AI_POLICY_FAILED", "result");
  if (raw.disposition !== undefined && raw.disposition !== expectedDisposition) throw new AiProviderError("AI_POLICY_FAILED", "result");
  // Keep the original AI response and its independent scores for auditability.
  const evidence = { ...raw, reviewRequired: expectedReview, disposition: expectedDisposition };
  const bounded = (n: number) => Number(new Prisma.Decimal(Math.max(0, n)).toFixed(4));
  const score = blocked ? 1 : bounded(raw.similarityScore);
  const similarTracks = raw.similarTracks.map((item: any) => {
    if (!item || typeof item !== "object" || typeof item.trackId !== "string" || !item.trackId || item.trackId.length > 191 || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < -1 || item.score > 1 || !Array.isArray(item.matchedSegments)) throw new AiProviderError("AI_INVALID_RESPONSE", "result");
    return { externalTrackId: item.trackId, score: bounded(item.score) };
  });
  try { return validateAiResult({ duplicate: blocked, riskScore: score, status: raw.decision, modelVersion: raw.modelVersion, similarTracks, evidence }); }
  catch { throw new AiProviderError("AI_POLICY_FAILED", "result"); }
}

export function aiRequiresReview(evidence: Prisma.JsonValue | undefined | null): boolean {
  return !!evidence && typeof evidence === "object" && !Array.isArray(evidence) && evidence.reviewRequired === true;
}
