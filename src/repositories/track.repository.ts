import { Prisma, PrismaClient } from "@prisma/client";
import { TrackListInput } from "../dto/track.dto";
import { AppError } from "../utils/errors";

const publicUser = { id: true, name: true, profileImage: true } as const;
const detail = {
  owner: { select: publicUser },
  contributions: { include: { user: { select: publicUser } } },
  verifications: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
} satisfies Prisma.TrackInclude;
export type TrackDetail = Prisma.TrackGetPayload<{ include: typeof detail }>;

export class TrackRepository {
  constructor(private readonly db: PrismaClient) {}
  create(data: Prisma.TrackCreateInput) {
    return this.db.track.create({ data, include: detail });
  }
  async findMany(query: TrackListInput, userId?: number) {
    const where: Prisma.TrackWhereInput = {
      ...(query.scope === "mine" ? { ownerId: userId! } : { isPublic: true }),
      ...(query.search ? { title: { contains: query.search } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.track.findMany({ where, include: { owner: { select: publicUser }, contributions: true },
        orderBy: [{ [query.sort]: query.order }, { id: query.order }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.track.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items, total };
  }
  findById(id: number) {
    return this.db.track.findUnique({ where: { id }, include: detail });
  }
  // Serialize edits/deletion against registration and ownership changes.
  withLockedTrack<T>(id: number, operation: (tx: Prisma.TransactionClient, track: TrackDetail) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Track WHERE id = ${id} FOR UPDATE`;
      const track = await tx.track.findUnique({ where: { id }, include: detail });
      if (!track) throw new AppError(404, "Track not found");
      return operation(tx, track);
    });
  }
  update(tx: Prisma.TransactionClient, id: number, data: Prisma.TrackUpdateInput) {
    return tx.track.update({ where: { id }, data, include: detail });
  }
  delete(tx: Prisma.TransactionClient, id: number) { return tx.track.delete({ where: { id } }); }
}
