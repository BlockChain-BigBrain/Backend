import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

export const createAuthRoutes = (controller: AuthController) => {
  const router = Router();
  router.post("/google", asyncHandler(controller.login));
  return router;
};