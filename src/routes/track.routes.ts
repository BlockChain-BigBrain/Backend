import { Router } from "express";
import { TrackController } from "../controllers/track.controller";
import { optionalAuth, requireAuth } from "../middlewares/auth.middleware";
import { uploadAudio } from "../middlewares/upload.middleware";
import { asyncHandler } from "../utils/asyncHandler";

export const createTrackRoutes = (controller: TrackController) => {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.get("/", optionalAuth, asyncHandler(controller.list));
  router.get("/:id/audio", optionalAuth, asyncHandler(controller.audio));
  router.get("/:id", optionalAuth, asyncHandler(controller.get));
  router.post("/", requireAuth, uploadAudio, asyncHandler(controller.create));
  router.patch("/:id", requireAuth, asyncHandler(controller.update));
  router.post("/:id/verify", requireAuth, asyncHandler(controller.verify));
  router.delete("/:id", requireAuth, asyncHandler(controller.remove));
  return router;
};
