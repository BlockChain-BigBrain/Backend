import "dotenv/config";

function duration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  if (!match || Number(match[1]) <= 0) throw new Error("Invalid JWT expiry: use a positive duration such as 1h or 14d");
  return Number(match[1]) * units[match[2]];
}

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
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 50),
};