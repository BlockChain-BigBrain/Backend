import { randomBytes } from "node:crypto";
import { verifyMessage } from "ethers";
import { config } from "../config";
import { body, wallet } from "../dto/rights.dto";
import { RightsRepository } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";
export class WalletService {
  constructor(private readonly repo: RightsRepository) {}
  async current(userId: number) {
    const user = await this.repo.db.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
    if (!user) throw new AppError(404, "User not found");
    return { walletAddress: user.walletAddress, bound: !!user.walletAddress };
  }
  async challenge(userId: number, value: unknown) {
    const input = body(value, ["walletAddress"]);
    let address: string;
    try { address = wallet(input.walletAddress); } catch { throw new AppError(400, "Invalid wallet address"); }
    const nonce = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const message = `Track-AI wallet ownership\nOrigin: ${new URL(config.frontendUrl).origin}\nUser: ${userId}\nAddress: ${address}\nNonce: ${nonce}\nExpires: ${expiresAt.toISOString()}\nPurpose: bind this wallet to this Track-AI account only`;
    return this.repo.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
      await tx.walletChallenge.upsert({ where: { userId }, create: { userId, walletAddress: address, nonce, message, expiresAt }, update: { walletAddress: address, nonce, message, expiresAt, consumedAt: null } });
      return { message, expiresAt, walletAddress: address };
    });
  }
  async bind(userId: number, value: unknown) {
    const signature = body(value, ["signature"]).signature;
    if (typeof signature !== "string" || !/^0x([a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/.test(signature)) throw new AppError(400, "Invalid wallet signature");
    return this.repo.db.$transaction(async tx => {
      // Track -> User lock order agrees with contribution finalization and registration.
      const tracks = await tx.$queryRaw<Array<{ id: number; contributionsFinalizedAt: Date | null; registrationStatus: string }>>`
        SELECT t.id,t.contributionsFinalizedAt,t.registrationStatus FROM Track t
        WHERE t.ownerId=${userId} OR EXISTS (SELECT 1 FROM Contribution c WHERE c.trackId=t.id AND c.userId=${userId})
        ORDER BY t.id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } }), challenge = await tx.walletChallenge.findUnique({ where: { userId } });
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) throw new AppError(409, "Wallet challenge is missing, consumed or expired");
      let recovered: string;
      try { recovered = verifyMessage(challenge.message, signature).toLowerCase(); } catch { throw new AppError(403, "Wallet signature is invalid"); }
      if (recovered !== challenge.walletAddress) throw new AppError(403, "Signature does not prove wallet ownership");
      if (user.walletAddress?.toLowerCase() !== challenge.walletAddress && tracks.some(track => track.contributionsFinalizedAt || ["PENDING", "REGISTERED"].includes(track.registrationStatus))) throw new AppError(409, "Wallet is locked by finalized contributions or registration");
      await tx.user.update({ where: { id: userId }, data: { walletAddress: challenge.walletAddress } });
      await tx.walletChallenge.update({ where: { userId }, data: { consumedAt: new Date() } });
      return { walletAddress: challenge.walletAddress, bound: true };
    });
  }
}
