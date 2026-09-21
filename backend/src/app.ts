import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { config } from "./config";
import { AuthController } from "./controllers/auth.controller";
import { TrackController } from "./controllers/track.controller";
import { requireAuth } from "./middlewares/auth.middleware";
import { createAuthRoutes } from "./routes/auth.routes";
import { createTrackRoutes } from "./routes/track.routes";
import { AuthService } from "./services/auth.service";
import { TrackService } from "./services/track.service";
import { UserRepository } from "./repositories/user.repository";
import { TrackRepository } from "./repositories/track.repository";
import { prisma } from "./utils/prisma";

const app = express();
const authController = new AuthController(new AuthService(new UserRepository(prisma)));
const trackController = new TrackController(new TrackService(new TrackRepository(prisma), prisma));

app.use(cors({ origin: config.frontendUrl }));
app.use(express.json());
app.use("/uploads", express.static(path.resolve(config.uploadDir)));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", createAuthRoutes(authController));
app.use("/api/tracks", createTrackRoutes(trackController));
app.get("/api/me", requireAuth, (req, res) => res.json({ userId: (req as Request & { userId?: number }).userId }));
app.use((error: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = error.statusCode ?? 500;
  res.status(statusCode).json({ error: statusCode === 500 ? "Internal server error" : error.message });
});

export default app;