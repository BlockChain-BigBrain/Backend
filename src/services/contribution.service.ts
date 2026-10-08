import { Prisma } from "@prisma/client";
import { contribution, wallet } from "../dto/rights.dto";
import { mutable, own, RightsRepository, RightsTrack } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";

export function creatorShares(track: RightsTrack, requireWallet = true) {
  const shares = new Map<number, { userId: number; walletAddress: string | null; percentage: Prisma.Decimal }>();
  for (const item of track.contributions) {
    if (item.percentage.lte(0) || item.percentage.gt(100)) throw new AppError(409, "Invalid stored contribution");
    const previous = shares.get(item.userId);
    shares.set(item.userId, { userId: item.userId, walletAddress: requireWallet ? wallet(item.user.walletAddress) : item.user.walletAddress, percentage: (previous?.percentage ?? new Prisma.Decimal(0)).plus(item.percentage) });
  }
  const result = [...shares.values()].sort((a, b) => a.userId - b.userId);
  if (!result.length || !result.reduce((sum, item) => sum.plus(item.percentage), new Prisma.Decimal(0)).eq(100)) throw new AppError(409, "Contributions must total exactly 100%");
  return result.map(item => ({ ...item, percentage: item.percentage.toFixed(2) }));
}
export class ContributionService {
  constructor(private readonly repo: RightsRepository) {}
  async list(id: number, userId?: number) {
    const track = await this.repo.track(id, userId);
    return { finalizedAt: track.contributionsFinalizedAt, contributions: track.contributions.map(({ user: _user, ...item }) => item), shares: track.contributionsFinalizedAt ? creatorShares(track, false).map(({ walletAddress: _wallet, ...item }) => item) : null };
  }
  async change(id: number, userId: number, action: "create" | "update" | "delete", value?: unknown, contributionId?: number) {
    const data = action === "delete" ? undefined : contribution(value, action === "update");
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId); mutable(track);
      if (track.contributionsFinalizedAt) throw new AppError(409, "Contributions are finalized");
      const existing = contributionId ? track.contributions.find(item => item.id === contributionId) : undefined;
      if (action !== "create" && !existing) throw new AppError(404, "Contribution not found for this track");
      if (action === "delete") return tx.contribution.delete({ where: { id: contributionId! } });
      const candidate = { userId: data!.userId ?? existing!.userId, role: data!.role ?? existing!.role, percentage: data!.percentage ?? existing!.percentage };
      if (!await tx.user.findUnique({ where: { id: candidate.userId }, select: { id: true } })) throw new AppError(400, "Contributor does not exist");
      if (track.contributions.some(item => item.id !== contributionId && item.userId === candidate.userId && item.role === candidate.role)) throw new AppError(409, "Duplicate user/role contribution");
      const total = track.contributions.filter(item => item.id !== contributionId).reduce((sum, item) => sum.plus(item.percentage), new Prisma.Decimal(0)).plus(candidate.percentage);
      if (total.gt(100)) throw new AppError(400, "Contribution total exceeds 100%");
      return action === "create" ? tx.contribution.create({ data: { trackId: id, ...candidate } }) : tx.contribution.update({ where: { id: contributionId! }, data: candidate });
    });
  }
  async finalize(id: number, userId: number) {
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId); mutable(track);
      // Lock participating wallets and use current reads before freezing the shares.
      const ids = [...new Set([track.ownerId, ...track.contributions.map(item => item.userId)])].sort((a, b) => a - b);
      for (const id of ids) {
        const users = await tx.$queryRaw<Array<{ walletAddress: string | null }>>`SELECT walletAddress FROM User WHERE id = ${id} FOR UPDATE`;
        if (id === track.ownerId) track.owner.walletAddress = users[0]?.walletAddress ?? null;
        for (const item of track.contributions) if (item.userId === id) item.user.walletAddress = users[0]?.walletAddress ?? null;
      }
      const shares = creatorShares(track);
      if (!track.contributionsFinalizedAt) await tx.track.update({ where: { id }, data: { contributionsFinalizedAt: new Date() } });
      return { finalized: true, shares };
    });
  }
}
