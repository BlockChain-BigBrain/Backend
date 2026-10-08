import { ContributionRole, Prisma } from "@prisma/client";
import { AppError } from "../utils/errors";

export interface ContributionInput {
  userId: number;
  role: ContributionRole;
  percentage: number;
}
export interface CreateTrackInput {
  title: string;
  prompt?: string | null;
  workLog?: string | null;
  isPublic?: boolean;
  contributors?: ContributionInput[];
}
export type UpdateTrackInput = Partial<Omit<CreateTrackInput, "contributors">>;
export interface TrackListInput {
  page: number;
  limit: number;
  search?: string;
  sort: "createdAt" | "title";
  order: "asc" | "desc";
  scope: "public" | "mine";
}

export function trackId(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d*$/.test(String(value))) throw new AppError(400, "Invalid track ID");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) throw new AppError(400, "Invalid track ID");
  return id;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, "Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new AppError(400, `${name} must be a string`);
  if (name === "title") {
    if (!value.trim() || [...value.trim()].length > 191) throw new AppError(400, "title must contain 1 to 191 characters");
    return value.trim();
  }
  if (Buffer.byteLength(value, "utf8") > 65535) throw new AppError(400, `${name} exceeds 65535 bytes`);
  return value;
}
function visibility(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError(400, "isPublic must be true or false");
}
function fields(body: Record<string, unknown>): UpdateTrackInput {
  const result: UpdateTrackInput = {};
  if (body.title !== undefined) result.title = text(body.title, "title")!;
  if (body.prompt !== undefined) result.prompt = text(body.prompt, "prompt", true);
  if (body.workLog !== undefined) result.workLog = text(body.workLog, "workLog", true);
  if (body.isPublic !== undefined) result.isPublic = visibility(body.isPublic);
  return result;
}
export function parseCreateTrack(value: unknown): CreateTrackInput {
  const body = object(value);
  for (const key of Object.keys(body)) if (!["title", "prompt", "workLog", "isPublic", "contributors"].includes(key)) throw new AppError(400, `Unexpected field: ${key}`);
  const result = fields(body);
  if (result.title === undefined) throw new AppError(400, "title is required");
  let contributors = body.contributors ?? [];
  if (typeof contributors === "string") {
    try { contributors = JSON.parse(contributors); } catch { throw new AppError(400, "contributors must be valid JSON"); }
  }
  if (!Array.isArray(contributors) || contributors.length > 100) throw new AppError(400, "contributors must be an array of at most 100 entries");
  let total = new Prisma.Decimal(0);
  const keys = new Set<string>();
  const validated = contributors.map(value => {
    const item = object(value);
    const userId = trackId(item.userId);
    if (typeof item.role !== "string" || !Object.values(ContributionRole).includes(item.role as ContributionRole)) throw new AppError(400, "Invalid contribution role");
    if (typeof item.percentage !== "number" || !Number.isFinite(item.percentage)) throw new AppError(400, "Invalid contribution percentage");
    const percentage = new Prisma.Decimal(item.percentage);
    if (percentage.lte(0) || percentage.gt(100) || percentage.decimalPlaces() > 2) throw new AppError(400, "percentage must be greater than 0, at most 100, with at most 2 decimals");
    const key = `${userId}:${item.role}`;
    if (keys.has(key)) throw new AppError(400, "Duplicate contributor role");
    keys.add(key); total = total.plus(percentage);
    return { userId, role: item.role as ContributionRole, percentage: item.percentage };
  });
  if (total.gt(100)) throw new AppError(400, "contribution percentages cannot exceed 100");
  return { ...result, title: result.title, contributors: validated };
}
export function parseUpdateTrack(value: unknown): UpdateTrackInput {
  const body = object(value);
  for (const key of Object.keys(body)) if (!["title", "prompt", "workLog", "isPublic"].includes(key)) throw new AppError(400, `Unexpected field: ${key}`);
  const result = fields(body);
  if (!Object.keys(result).length) throw new AppError(400, "At least one editable field is required");
  return result;
}
export function parseTrackList(value: unknown): TrackListInput {
  const body = object(value);
  const number = (key: string, fallback: number, max: number) => {
    if (body[key] === undefined) return fallback;
    const result = trackId(body[key]);
    if (result > max) throw new AppError(400, `${key} exceeds ${max}`);
    return result;
  };
  if (body.search !== undefined && (typeof body.search !== "string" || [...body.search].length > 191)) throw new AppError(400, "Invalid search");
  const sort = body.sort ?? "createdAt", order = body.order ?? "desc", scope = body.scope ?? "public";
  if (sort !== "createdAt" && sort !== "title") throw new AppError(400, "sort must be createdAt or title");
  if (order !== "asc" && order !== "desc") throw new AppError(400, "order must be asc or desc");
  if (scope !== "public" && scope !== "mine") throw new AppError(400, "scope must be public or mine");
  return { page: number("page", 1, 10000), limit: number("limit", 20, 100), search: (body.search as string | undefined)?.trim(), sort, order, scope };
}
