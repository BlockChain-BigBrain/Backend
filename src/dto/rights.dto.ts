import { Currency, ContributionRole, LicenseType, Prisma, RiskStatus } from "@prisma/client";
import { getAddress } from "ethers";
import { AppError } from "../utils/errors";
import { trackId } from "./track.dto";

export function body(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, "Expected an object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!allowed.includes(key)) throw new AppError(400, `Unexpected field: ${key}`);
  return result;
}
export function string(value: unknown, name: string, max = 191): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AppError(400, `Invalid ${name}`);
  return value.trim();
}
export function flag(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new AppError(400, "Expected a boolean");
  return value;
}
export const MoneyDecimal = Prisma.Decimal.clone({ precision: 80 });
export const currencyScale: Partial<Record<Currency, number>> = { KRW: 0, USD: 2, ETH: 18, MATIC: 18 };
export function currency(value: unknown): Exclude<Currency, "UNKNOWN"> {
  if (typeof value !== "string" || !(value in currencyScale)) throw new AppError(400, "Unsupported currency");
  return value as Exclude<Currency, "UNKNOWN">;
}
export function money(value: unknown, unit: Currency, allowZero = false): Prisma.Decimal {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(\.\d+)?$/.test(String(value))) throw new AppError(400, "Invalid amount");
  const amount = new MoneyDecimal(value);
  if (currencyScale[unit] === undefined || amount.decimalPlaces() > currencyScale[unit]! || amount.gte('1000000000000000000') || (allowZero ? amount.lt(0) : amount.lte(0))) throw new AppError(400, "Invalid amount or currency precision");
  return amount;
}
export function wallet(value: unknown): string {
  if (typeof value !== "string") throw new AppError(409, "A wallet address must be registered");
  try { const address = getAddress(value).toLowerCase(); if (address === "0x0000000000000000000000000000000000000000") throw new Error(); return address; } catch { throw new AppError(409, "Invalid registered wallet address"); }
}
export function contribution(value: unknown, partial = false) {
  const input = body(value, partial ? ["role", "percentage"] : ["userId", "role", "percentage"]);
  const result: { userId?: number; role?: ContributionRole; percentage?: Prisma.Decimal } = {};
  if (!partial) result.userId = trackId(input.userId);
  if (input.role !== undefined || !partial) {
    if (typeof input.role !== "string" || !Object.values(ContributionRole).includes(input.role as ContributionRole)) throw new AppError(400, "Invalid contribution role");
    result.role = input.role as ContributionRole;
  }
  if (input.percentage !== undefined || !partial) {
    if ((typeof input.percentage !== "number" && typeof input.percentage !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(input.percentage))) throw new AppError(400, "Invalid percentage");
    result.percentage = new Prisma.Decimal(input.percentage);
    if (result.percentage.lte(0) || result.percentage.gt(100)) throw new AppError(400, "percentage must be greater than 0 and at most 100");
  }
  if (!Object.keys(result).length) throw new AppError(400, "An editable field is required");
  return result;
}
export function riskStatus(value: unknown): RiskStatus {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new AppError(400, "riskScore must be between 0 and 1");
  return value < 0.8 ? "PASS" : value < 0.9 ? "WARN" : "HOLD";
}
export function licenseType(value: unknown): LicenseType {
  if (value !== "COMMERCIAL" && value !== "PERSONAL") throw new AppError(400, "Invalid licenseType");
  return value;
}
export function pagination(value: unknown) {
  const input = body(value ?? {}, ["page", "limit", "search", "sort", "order", "minPrice", "maxPrice", "currency", "scope"]);
  const page = input.page === undefined ? 1 : trackId(input.page);
  const limit = input.limit === undefined ? 20 : trackId(input.limit);
  if (page > 10000 || limit > 100) throw new AppError(400, "Pagination limit exceeded");
  return { input, page, limit, skip: (page - 1) * limit };
}
