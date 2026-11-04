import { AppError } from "../utils/errors";

// Only fixed, public-safe messages may be persisted or logged. Never retain
// remote response bodies, request headers, file paths or original error text.
const messages = {
  AI_NOT_CONFIGURED: "Configure AI_API_URL and TRACK_AI_API_KEY",
  AI_AUTH_FAILED: "AI server authentication failed",
  AI_CONNECTION_FAILED: "Cannot connect to the AI server",
  AI_TIMEOUT: "AI verification timed out",
  AI_HTTP_ERROR: "AI server rejected the verification request",
  AI_JOB_FAILED: "AI analysis job failed",
  AI_INVALID_JSON: "AI server returned invalid JSON",
  AI_INVALID_RESPONSE: "AI server returned an invalid response",
  AI_AUDIO_HASH_MISMATCH: "Audio hash does not match the verification input",
  AI_AUDIO_READ_FAILED: "Cannot read the verification audio",
  AI_POLICY_FAILED: "AI verdict failed policy validation",
  AI_RESULT_SAVE_FAILED: "AI result could not be saved; check database schema and availability",
  AI_ANALYSIS_FAILED: "Verification provider failed or returned invalid data",
} as const;
export type AiErrorCode = keyof typeof messages;
export type AiStage = "configuration" | "audio" | "upload" | "poll" | "result" | "persistence";

export class AiProviderError extends AppError {
  constructor(readonly code: AiErrorCode, readonly stage: AiStage, statusCode = 502, readonly upstreamStatus?: number) {
    super(statusCode, messages[code]);
  }
}

export function aiFailure(error: unknown, source: string) {
  if (source === "UNCONFIGURED") return new AiProviderError("AI_NOT_CONFIGURED", "configuration", 503);
  if (error instanceof AiProviderError) return error;
  // Preserve compatibility with providers that use the existing timeout error.
  if (error instanceof AppError && error.message === "AI verification timed out") return new AiProviderError("AI_TIMEOUT", "poll", 503);
  return new AiProviderError("AI_ANALYSIS_FAILED", "result");
}
