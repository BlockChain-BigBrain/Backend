import { Prisma } from "@prisma/client";

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
export function publicHttpError(error: Error & { statusCode?: number; type?: string }) {
  if (error.type === "entity.parse.failed") return { statusCode: 400, message: "Invalid JSON body" };
  if (error.type === "entity.too.large") return { statusCode: 413, message: "Request body is too large" };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2003", "P2034"].includes(error.code)) return { statusCode: 409, message: "Database conflict or concurrent update" };
    if (error.code === "P2025") return { statusCode: 404, message: "Record not found" };
    if (error.code === "P2000") return { statusCode: 400, message: "Input value is too long" };
  }
  const statusCode = error.statusCode ?? 500;
  return { statusCode, message: statusCode >= 500 && !(error instanceof AppError) ? "Internal server error" : error.message };
}
