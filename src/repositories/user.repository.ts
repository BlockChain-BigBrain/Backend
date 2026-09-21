import { AppError } from "../utils/errors";
import { PrismaClient } from "@prisma/client";

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: number) { return this.db.user.findUnique({ where: { id } }); }

  findByEmail(email: string) { return this.db.user.findUnique({ where: { email } }); }

  createLocalUser(data: { email: string; passwordHash: string; nickname: string; preferredLanguage?: string }) {
    return this.db.user.create({ data: { email: data.email, passwordHash: data.passwordHash,
      name: data.nickname, preferredLanguage: data.preferredLanguage ?? "ko", provider: "LOCAL" } });
  }

  setRefreshHash(id: number, hash: string) {
    return this.db.user.update({ where: { id }, data: { refreshTokenHash: hash } });
  }

  // Compare-and-swap prevents concurrent requests from reusing a rotated token.
  replaceRefreshHash(id: number, previous: string, next: string | null) {
    return this.db.user.updateMany({ where: { id, refreshTokenHash: previous }, data: { refreshTokenHash: next } });
  }

  async findOrCreateGoogleUser(data: { googleId: string; email: string; name: string; profileImage?: string }) {
    const existing = await this.db.user.findUnique({ where: { googleId: data.googleId } });
    if (existing) return existing;
    if (await this.findByEmail(data.email)) throw new AppError(409, "이미 가입된 이메일입니다.");
    return this.db.user.upsert({
      where: { googleId: data.googleId },
      update: { email: data.email, name: data.name, profileImage: data.profileImage },
      create: data,
    });
  }
}