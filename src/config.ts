import "dotenv/config";
import { parse } from "dotenv";
import { readFileSync } from "node:fs";
// Optional local blockchain overlay only; it cannot replace DB/auth secrets.
if(process.env.BLOCKCHAIN_ENV_FILE) {
  const overlay=parse(readFileSync(process.env.BLOCKCHAIN_ENV_FILE));
  for(const [key,value] of Object.entries(overlay)) {
    if(!/^(BLOCKCHAIN_|EIP712_|VERIFICATION_SIGNER_|TRACK_REGISTRY_ADDRESS$|LICENSE_NFT_ADDRESS$|LICENSE_MARKETPLACE_ADDRESS$|REVENUE_SPLITTER_ADDRESS$|REGISTRATION_TTL_SECONDS$)/.test(key)) throw new Error("Non-blockchain setting in BLOCKCHAIN_ENV_FILE");
    process.env[key]=value;
  }
}
import path from "node:path";

function duration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  if (!match || Number(match[1]) <= 0) throw new Error("Invalid JWT expiry: use a positive duration such as 1h or 14d");
  return Number(match[1]) * units[match[2]];
}

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 50);
const maxUploadBytes = Math.floor(maxUploadMb * 1024 * 1024);
if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0 || maxUploadMb > 100 || maxUploadBytes < 1) {
  throw new Error("MAX_UPLOAD_MB must be greater than 0 and at most 100");
}

function providerMode(name: string): "unconfigured" | "mock" {
  const value = process.env[name] ?? "unconfigured";
  if (value !== "unconfigured" && value !== "mock") throw new Error(`${name} must be unconfigured or mock`);
  return value;
}

const verificationTimeoutMs = Number(process.env.VERIFICATION_TIMEOUT_MS ?? 30000);
if (!Number.isSafeInteger(verificationTimeoutMs) || verificationTimeoutMs < 100 || verificationTimeoutMs > 60000) throw new Error("VERIFICATION_TIMEOUT_MS must be between 100 and 60000");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `http://localhost:${process.env.PORT ?? 4000}/api/v1/auth/callback/google`,
  cookieSecure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
  jwtSecret: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? "",
  accessExpiresIn: duration(process.env.JWT_ACCESS_EXPIRES_IN ?? "15m"),
  refreshExpiresIn: duration(process.env.JWT_REFRESH_EXPIRES_IN ?? "14d"),
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  metadataDir: process.env.METADATA_DIR ?? path.join(process.env.UPLOAD_DIR ?? "uploads", "metadata"),
  aiProviderMode: providerMode("AI_PROVIDER_MODE"),
  verificationTimeoutMs,
  paymentProviderMode: providerMode("PAYMENT_PROVIDER_MODE"),
  maxUploadMb,
  maxUploadBytes,
};