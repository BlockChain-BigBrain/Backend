import { Router } from "express";
import { TrackController } from "../controllers/track.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { audioUpload } from "../middlewares/upload.middleware";
import { asyncHandler } from "../utils/asyncHandler";

export const createTrackRoutes = (controller: TrackController) => {
  const router = Router();
  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.get));
  router.post("/", requireAuth, audioUpload.single("audio"), asyncHandler(controller.create));
  router.post("/:id/verify", requireAuth, asyncHandler(controller.verify));
  router.delete("/:id", requireAuth, asyncHandler(controller.remove));
  return router;
};