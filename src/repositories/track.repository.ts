import { PrismaClient } from "@prisma/client";

export class TrackRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Parameters<PrismaClient["track"]["create"]>[0]["data"]) {
    return this.db.track.create({ data, include: { owner: true, contributions: true } });
  }

  findMany() {
    return this.db.track.findMany({ include: { owner: true, contributions: true }, orderBy: { createdAt: "desc" } });
  }

  findById(id: number) {
    return this.db.track.findUnique({
      where: { id },
      include: { owner: true, contributions: { include: { user: true } }, verifications: true },
    });
  }

  delete(id: number) { return this.db.track.delete({ where: { id } }); }
}