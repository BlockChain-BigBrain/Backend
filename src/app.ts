import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
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
import { swaggerSpec } from "./docs/swagger";

const app = express();
const authController = new AuthController(new AuthService(new UserRepository(prisma)));
const trackController = new TrackController(new TrackService(new TrackRepository(prisma), prisma));

app.use(cors({ origin: new URL(config.frontendUrl).origin, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(path.resolve(config.uploadDir)));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { swaggerOptions: { persistAuthorization: false } }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/google08be8fbfab8fe440.html", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/google08be8fbfab8fe440.html"));
});
// Keep the old OAuth redirect URI working while provider settings are updated.
app.get("/api/auth/callback/google", (req, res) => res.redirect(307, `/api/v1/auth/callback/google${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`));
app.use("/api/v1/auth", createAuthRoutes(authController));
app.use("/api/tracks", createTrackRoutes(trackController));
app.get("/api/me", requireAuth, (req, res) => res.json({ userId: (req as Request & { userId?: number }).userId }));
app.use((error: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = error.statusCode ?? 500;
  if (_req.path.startsWith("/api/v1/auth/")) {
    res.status(statusCode).json({ isSuccess: false, code: `COMMON${statusCode}`, message: statusCode === 500 ? "Internal server error" : error.message, result: null });
    return;
  }
  res.status(statusCode).json({ error: statusCode === 500 ? "Internal server error" : error.message });
});

export default app;