import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../utils/errors";

const user = { id: true, name: true, walletAddress: true } as const;
export const rightsTrackInclude = {
  owner: { select: user },
  contributions: { include: { user: { select: user } }, orderBy: [{ userId: "asc" }, { role: "asc" }] },
  verifications: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { similarityResults: { orderBy: { score: "desc" }, take: 3 } } },
  metadataSnapshots: { orderBy: { version: "desc" }, take: 1 },
  registrationRequests: { orderBy: { id: "desc" }, take: 1 },
} satisfies Prisma.TrackInclude;
export type RightsTrack = Prisma.TrackGetPayload<{ include: typeof rightsTrackInclude }>;
export function own(track: RightsTrack, userId: number) {
  if (track.ownerId !== userId) throw new AppError(403, "Only the track owner may perform this action");
}
export function mutable(track: RightsTrack) {
  if (["PENDING", "REGISTERED"].includes(track.registrationStatus) || track.registrationTxHash || track.blockchainTrackId) throw new AppError(409, "Track registration locks this operation");
}
export class RightsRepository {
  constructor(readonly db: PrismaClient) {}
  async track(id: number, userId?: number, ownerOnly = false) {
    const track = await this.db.track.findUnique({ where: { id }, include: rightsTrackInclude });
    if (!track || (!ownerOnly && !track.isPublic && track.ownerId !== userId)) throw new AppError(404, "Track not found");
    if (ownerOnly) own(track, userId!);
    return track;
  }
  locked<T>(id: number, operation: (tx: Prisma.TransactionClient, track: RightsTrack) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Track WHERE id = ${id} FOR UPDATE`;
      const track = await tx.track.findUnique({ where: { id }, include: rightsTrackInclude });
      if (!track) throw new AppError(404, "Track not found");
      return operation(tx, track);
    }, { timeout: 15000 });
  }
  async purchase<T>(id: number, buyerId: number, operation: (tx: Prisma.TransactionClient, request: Prisma.PurchaseRequestGetPayload<{ include: { license: true; transaction: true } }>, track: RightsTrack) => Promise<T>) {
    const request = await this.db.purchaseRequest.findUnique({ where: { id } });
    if (!request) throw new AppError(404, "Purchase request not found");
    if (request.buyerId !== buyerId) throw new AppError(403, "Purchase request belongs to another user");
    return this.locked(request.trackId, async (tx, track) => {
      await tx.$queryRaw`SELECT id FROM PurchaseRequest WHERE id = ${id} FOR UPDATE`;
      const current = await tx.purchaseRequest.findUniqueOrThrow({ where: { id }, include: { license: true, transaction: true } });
      return operation(tx, current, track);
    });
  }
}
