import { Prisma, RiskStatus } from "@prisma/client";
import { riskStatus } from "../dto/rights.dto";
import { AppError } from "../utils/errors";

export interface AiVerificationRequest { trackId: number; audioHash: string; audioPath: string; }
export interface AiVerificationResponse {
  duplicate: boolean;
  riskScore: number;
  status: RiskStatus;
  modelVersion: string;
  similarTracks: Array<{ trackId?: number; url?: string; score: number }>;
}
export interface AiVerificationProvider {
  readonly source: "AI" | "MOCK" | "UNCONFIGURED";
  verify(request: AiVerificationRequest, signal?: AbortSignal): Promise<AiVerificationResponse>;
}
export function validateAiResult(value: AiVerificationResponse): AiVerificationResponse {
  let scoreStatus: RiskStatus;
  try { scoreStatus = riskStatus(value?.riskScore); } catch { throw new AppError(502, "Invalid AI risk score"); }
  if (!value || typeof value.duplicate !== "boolean" || value.status !== scoreStatus || new Prisma.Decimal(value.riskScore).decimalPlaces() > 4 || typeof value.modelVersion !== "string" || !value.modelVersion.trim() || value.modelVersion.length > 191 || !Array.isArray(value.similarTracks) || value.similarTracks.length > 3) throw new AppError(502, "Invalid AI verification response");
  const identities = new Set<string>();
  for (const item of value.similarTracks) {
    try { riskStatus(item.score); if (new Prisma.Decimal(item.score).decimalPlaces() > 4) throw new Error(); } catch { throw new AppError(502, "Invalid similarity score"); }
    if ((!item.trackId && !item.url) || (item.trackId !== undefined && (!Number.isSafeInteger(item.trackId) || item.trackId <= 0))) throw new AppError(502, "Invalid comparison track");
    if (item.url !== undefined) {
      try { const url = new URL(item.url); if (!["http:", "https:"].includes(url.protocol) || item.url.length > 191) throw new Error(); } catch { throw new AppError(502, "Invalid comparison URL"); }
    }
    const key = item.trackId ? `track:${item.trackId}` : `url:${item.url}`;
    if (identities.has(key)) throw new AppError(502, "Duplicate comparison track"); identities.add(key);
  }
  return value;
}
export class UnconfiguredAiVerificationProvider implements AiVerificationProvider {
  readonly source = "UNCONFIGURED";
  async verify(_request: AiVerificationRequest): Promise<AiVerificationResponse> { throw new AppError(503, "AI provider is not configured"); }
}
export class MockAiVerificationProvider implements AiVerificationProvider {
  readonly source = "MOCK";
  constructor(private readonly fixture: AiVerificationResponse = { duplicate: false, riskScore: 0.72, status: "PASS", modelVersion: "fixture-clap-v1", similarTracks: [] }) {}
  async verify(_request: AiVerificationRequest) { return structuredClone(this.fixture); }
}
