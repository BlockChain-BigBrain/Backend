import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { GoogleLoginRequest } from "../dto/auth.dto";
import { UserRepository } from "../repositories/user.repository";
import { AppError } from "../utils/errors";

const googleClient = new OAuth2Client(config.googleClientId);

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async loginWithGoogle({ idToken }: GoogleLoginRequest) {
    if (!idToken || !config.googleClientId) throw new AppError(400, "idToken and GOOGLE_CLIENT_ID are required");
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new AppError(401, "Invalid Google identity");
    const user = await this.users.findOrCreateGoogleUser({
      googleId: payload.sub, email: payload.email, name: payload.name ?? payload.email, profileImage: payload.picture,
    });
    const token = jwt.sign({ userId: user.id, email: user.email }, config.jwtSecret, { expiresIn: "7d" });
    return { token, user };
  }
}