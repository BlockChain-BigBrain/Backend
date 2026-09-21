import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { AppError } from "../utils/errors";

export interface AuthenticatedRequest extends Request { userId?: number; }

export function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return next(new AppError(401, "Authorization token is required"));
  try {
    req.userId = (jwt.verify(token, config.jwtSecret) as { userId: number }).userId;
    return next();
  } catch { return next(new AppError(401, "Invalid or expired token")); }
}