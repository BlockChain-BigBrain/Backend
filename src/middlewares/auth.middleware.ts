import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { AppError } from "../utils/errors";

export interface AuthenticatedRequest extends Request { userId?: number; }

export function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return next(new AppError(401, "Authorization token is required"));
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload === "string" || payload.tokenType !== "access" || typeof payload.sub !== "string" || !/^[1-9]\d*$/.test(payload.sub) || !Number.isSafeInteger(Number(payload.sub))) throw new Error();
    req.userId = Number(payload.sub);
    return next();
  } catch { return next(new AppError(401, "Invalid or expired token")); }
}
