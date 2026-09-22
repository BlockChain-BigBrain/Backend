import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middlewares/auth.middleware";

export const createAuthRoutes = (controller: AuthController) => {
  const router = Router();
  router.post("/signup", asyncHandler(controller.signUp));
  router.post("/login", asyncHandler(controller.logIn));
  router.get("/login/google", asyncHandler(controller.startGoogle));
  router.get("/callback/google", asyncHandler(controller.callbackGoogle));
  router.post("/refresh", asyncHandler(controller.refresh));
  router.post("/logout", asyncHandler(controller.logout));
  router.get("/me", requireAuth, asyncHandler(controller.me));
  return router;
};
