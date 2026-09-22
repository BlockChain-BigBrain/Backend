import { createHash, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import * as bcrypt from "bcryptjs";
import { SignUpRequest, LogInRequest } from "../dto/auth.dto";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { UserRepository } from "../repositories/user.repository";
import { AppError } from "../utils/errors";

export const refreshMaxAge = config.refreshExpiresIn * 1000;
// Prehash the whole JWT so bcrypt's 72-byte limit cannot truncate its signature/jti.
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
type TokenUser = { id: number; email: string };

export class AuthService {
  constructor(private readonly users: UserRepository, private readonly google = new OAuth2Client(
    config.googleClientId, config.googleClientSecret, config.googleCallbackUrl,
  )) {}

  async signUp(input: SignUpRequest) {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw new AppError(409, "이미 가입된 이메일입니다.");
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await this.users.createLocalUser({ ...input, email, nickname: input.nickname.trim(), passwordHash });
      return { id: user.id, email: user.email, nickname: user.name };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new AppError(409, "이미 가입된 이메일입니다.");
      throw error;
    }
  }

  async logIn(input: LogInRequest) {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());
    if (!user || user.provider !== "LOCAL" || !user.passwordHash || !await bcrypt.compare(input.password, user.passwordHash)) {
      throw new AppError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    const pair = this.issueTokens(user);
    await this.users.setRefreshHash(user.id, await bcrypt.hash(hash(pair.refreshToken), 12));
    return pair;
  }

  authorizationUrl(state: string) {
    if (!config.googleClientId || !config.googleClientSecret || !config.jwtRefreshSecret || !config.jwtSecret) {
      throw new AppError(503, "Google OAuth and JWT environment variables must be configured");
    }
    return this.google.generateAuthUrl({ scope: ["openid", "email", "profile"], state, access_type: "online" });
  }

  async completeGoogleLogin(code: string) {
    const { tokens } = await this.google.getToken(code);
    if (!tokens.id_token) throw new AppError(401, "Google identity is missing");
    const ticket = await this.google.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified) throw new AppError(401, "Invalid Google identity");
    const user = await this.users.findOrCreateGoogleUser({
      googleId: profile.sub, email: profile.email.trim().toLowerCase(),
      name: profile.name ?? profile.email, profileImage: profile.picture,
    });
    const pair = this.issueTokens(user);
    await this.users.setRefreshHash(user.id, await bcrypt.hash(hash(pair.refreshToken), 12));
    return pair;
  }

  private issueTokens(user: TokenUser) {
    if (!config.jwtSecret || !config.jwtRefreshSecret) throw new AppError(503, "JWT secrets must be configured");
    return {
      accessToken: jwt.sign({ sub: String(user.id), email: user.email, tokenType: "access" }, config.jwtSecret,
        { algorithm: "HS256", expiresIn: config.accessExpiresIn }),
      refreshToken: jwt.sign({ sub: String(user.id), tokenType: "refresh" }, config.jwtRefreshSecret,
        { algorithm: "HS256", expiresIn: config.refreshExpiresIn, jwtid: randomUUID() }),
    };
  }

  private refreshUserId(token?: string): number {
    if (!token) throw new AppError(401, "Refresh token is required");
    try {
      const payload = jwt.verify(token, config.jwtRefreshSecret, { algorithms: ["HS256"] });
      if (typeof payload === "string" || payload.tokenType !== "refresh" || typeof payload.sub !== "string" || !/^[1-9]\d*$/.test(payload.sub) || !Number.isSafeInteger(Number(payload.sub))) throw new Error();
      return Number(payload.sub);
    } catch { throw new AppError(401, "Invalid or expired refresh token"); }
  }

  async refresh(token?: string) {
    const id = this.refreshUserId(token);
    const user = await this.users.findById(id);
    const previousHash = user?.refreshTokenHash;
    if (!user || !previousHash || !await bcrypt.compare(hash(token!), previousHash)) throw new AppError(401, "Please log in again");
    const pair = this.issueTokens(user);
    const result = await this.users.replaceRefreshHash(id, previousHash, await bcrypt.hash(hash(pair.refreshToken), 12));
    if (result.count !== 1) throw new AppError(401, "Refresh token already used");
    return pair;
  }

  async logout(token?: string) {
    let id: number;
    try { id = this.refreshUserId(token); } catch { return; }
    const user = await this.users.findById(id);
    const previousHash = user?.refreshTokenHash;
    if (previousHash && await bcrypt.compare(hash(token!), previousHash)) {
      await this.users.replaceRefreshHash(id, previousHash, null);
    }
  }

  async me(id: number) {
    const user = await this.users.findById(id);
    if (!user) throw new AppError(401, "User not found");
    return { id: user.id, email: user.email, nickname: user.name };
  }
}
