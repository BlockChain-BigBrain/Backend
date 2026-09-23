import { PrismaClient } from "@prisma/client";

const publicUser = { id: true, name: true, profileImage: true } as const;

export class TrackRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Parameters<PrismaClient["track"]["create"]>[0]["data"]) {
    return this.db.track.create({ data, include: { owner: { select: publicUser }, contributions: true } });
  }

  findMany() {
    return this.db.track.findMany({ include: { owner: { select: publicUser }, contributions: true }, orderBy: { createdAt: "desc" } });
  }

  findById(id: number) {
    return this.db.track.findUnique({
      where: { id },
      include: { owner: { select: publicUser }, contributions: { include: { user: { select: publicUser } } }, verifications: true },
    });
  }

  delete(id: number) { return this.db.track.delete({ where: { id } }); }
}