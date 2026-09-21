import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";

export class AuthController {
  constructor(private readonly auth: AuthService) {}
  login = async (req: Request, res: Response) => {
    res.json(await this.auth.loginWithGoogle(req.body));
  };
}