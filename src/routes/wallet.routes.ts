import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../middlewares/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/errors";
import { config } from "../config";

const CHALLENGE_MS = 5 * 60 * 1000;
const addressOf = (value: unknown): string => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new AppError(400, "Invalid wallet address");
  try { return getAddress(value); } catch { throw new AppError(400, "Invalid wallet address"); }
};
const signatureOf = (value: unknown): string => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) throw new AppError(400, "Invalid wallet signature");
  return value;
};

export function createWalletRoutes(db: PrismaClient) {
  const router = Router();
  router.use(requireAuth);
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  router.post("/me/wallet/challenge", asyncHandler(async (req: AuthenticatedRequest, res) => {
    const address = addressOf(req.body?.walletAddress);
    const userId = req.userId!;
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppError(401, "User not found");
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + CHALLENGE_MS);
    const message = [
      "Track-AI wallet ownership verification",
      "This signature only links your wallet to your Track-AI account.",
      "It does not authorize a transaction or payment.",
      `Origin: ${new URL(config.frontendUrl).origin}`,
      `User ID: ${userId}`,
      `Wallet: ${address}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt.toISOString()}`,
    ].join("\n");
    await db.walletChallenge.upsert({
      where: { userId },
      create: { userId, walletAddress: address, nonce, message, expiresAt },
      update: { walletAddress: address, nonce, message, expiresAt, consumedAt: null },
    });
    res.json({ message, walletAddress: address, expiresAt: expiresAt.toISOString() });
  }));

  router.post("/me/wallet", asyncHandler(async (req: AuthenticatedRequest, res) => {
    const signature = signatureOf(req.body?.signature);
    const userId = req.userId!;
    // Consume and link in one DB transaction to prevent replay and concurrent binding.
    let result: { walletAddress: string | null }; 
    try { result = await db.$transaction(async tx => {
      const challenge = await tx.walletChallenge.findUnique({ where: { userId } });
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
        throw new AppError(401, "Wallet challenge expired or already used");
      }
      let recovered: string;
      try { recovered = getAddress(verifyMessage(challenge.message, signature)); }
      catch { throw new AppError(401, "Invalid wallet signature"); }
      if (recovered !== getAddress(challenge.walletAddress)) throw new AppError(401, "Wallet signature does not match challenge");
      const consumed = await tx.walletChallenge.updateMany({
        where: { id: challenge.id, nonce: challenge.nonce, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new AppError(409, "Wallet challenge already used");
      const user = await tx.user.update({ where: { id: userId }, data: { walletAddress: recovered }, select: { id: true, walletAddress: true } });
      return { walletAddress: user.walletAddress };
    }); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new AppError(409, "Wallet already linked to another account");
      throw error;
    }
    res.json(result);
  }));

  router.get("/me/wallet", asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = await db.user.findUnique({ where: { id: req.userId! }, select: { walletAddress: true } });
    if (!user) throw new AppError(401, "User not found");
    res.json({ walletAddress: user.walletAddress });
  }));
  return router;
}
