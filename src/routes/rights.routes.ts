import { Router } from "express";
import { RightsController } from "../controllers/rights.controller";
import { optionalAuth, requireAuth } from "../middlewares/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler";
export function createRightsRoutes(controller: RightsController) {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  const read = (path: string, handler: Parameters<typeof asyncHandler>[0], owner = false) => router.get(path, owner ? requireAuth : optionalAuth, asyncHandler(handler));
  const post = (path: string, handler: Parameters<typeof asyncHandler>[0]) => router.post(path, requireAuth, asyncHandler(handler));
  read("/users/me/wallet", controller.wallet, true);
  post("/users/me/wallet/challenge", controller.walletChallenge);
  post("/users/me/wallet", controller.bindWallet);
  const track = "/tracks/:id";
  read(`${track}/contributors`, controller.contributors);
  post(`${track}/contributors`, controller.addContributor);
  router.patch(`${track}/contributors/:contributionId`, requireAuth, asyncHandler(controller.updateContributor));
  router.delete(`${track}/contributors/:contributionId`, requireAuth, asyncHandler(controller.deleteContributor));
  post(`${track}/contributors/finalize`, controller.finalize);
  post(`${track}/verify`, controller.verify); post(`${track}/reverify`, controller.reverify);
  read(`${track}/verification`, controller.verification); read(`${track}/verifications`, controller.verifications, true);
  read(`${track}/metadata`, controller.metadata, true); post(`${track}/metadata/prepare`, controller.prepareMetadata); read(`${track}/ipfs`, controller.ipfs, true);
  post(`${track}/metadata/upload`, controller.uploadMetadata);
  post(`${track}/registration-payload`, controller.register); post(`${track}/registration/confirm`, controller.confirm);
  post(`${track}/register`, controller.register); post(`${track}/register/confirm`, controller.confirm); post(`${track}/register/cancel`, controller.cancelRegistration);
  read(`${track}/registration-payload`, controller.payload, true); read(`${track}/blockchain`, controller.blockchain, true);
  post("/market/tracks", controller.marketCreate); read("/market/tracks", controller.marketList); read("/market/tracks/:id", controller.marketGet);
  router.patch("/market/tracks/:id", requireAuth, asyncHandler(controller.marketUpdate)); router.delete("/market/tracks/:id", requireAuth, asyncHandler(controller.marketDelete));
  post("/licenses/purchase", controller.purchase); read("/licenses/requests/:id", controller.purchaseStatus, true);
  post("/licenses/requests/:id/cancel", controller.cancelPurchase); post("/licenses/requests/:id/reconcile", controller.reconcile);
  read("/licenses/:id/status", controller.licenseStatus, true); read("/licenses/:id", controller.license, true); read("/users/me/licenses", controller.licenses, true);
  read("/users/me/transactions", controller.transactions, true); read("/transactions/:id", controller.transaction, true);
  read("/users/me/revenue", controller.revenue, true); read("/users/me/revenue/history", controller.revenueHistory, true); post("/revenue/withdraw", controller.withdraw);
  return router;
}

