import { PrismaClient } from "@prisma/client";

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  findOrCreateGoogleUser(data: { googleId: string; email: string; name: string; profileImage?: string }) {
    return this.db.user.upsert({
      where: { googleId: data.googleId },
      update: { email: data.email, name: data.name, profileImage: data.profileImage },
      create: data,
    });
  }
}