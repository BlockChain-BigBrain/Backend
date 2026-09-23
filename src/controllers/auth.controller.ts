import { logServerError } from "../utils/errorLogger";
import { validateCredentials } from "../dto/auth.dto";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Request, Response, CookieOptions } from "express";
import { config } from "../config";
import { AuthService, refreshMaxAge } from "../services/auth.service";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { AppError } from "../utils/errors";

const authPath = "/api/v1/auth";
const refreshOptions: CookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSecure ? "none" : "strict", path: authPath };
const stateOptions: CookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/api" };
export function readCookie(req: Request, name: string): string | undefined {
  const values = req.headers.cookie?.split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values?.length !== 1) return undefined;
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return undefined; }
}
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/auth/callback";
  const target = new URL(value, config.frontendUrl);
  return target.origin === new URL(config.frontendUrl).origin ? target.pathname + target.search + target.hash : "/auth/callback";
}

const success = (result: unknown) => ({ isSuccess: true, code: "COMMON200", message: "요청에 성공했습니다.", result });

export class AuthController {
  // Short-lived, single-use state. A shared session store is needed for multiple server instances.
  private readonly states = new Map<string, { expires: number; redirect: string; swagger: boolean; frontend: boolean }>();
  constructor(private readonly auth: AuthService) {}

  signUp = async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(success(await this.auth.signUp(validateCredentials(req.body, true))));
  };
  logIn = async (req: Request, res: Response) => {
    this.checkOrigin(req);
    res.setHeader("Cache-Control", "no-store");
    const pair = await this.auth.logIn(validateCredentials(req.body));
    this.setRefresh(res, pair.refreshToken, req.query?.target === "frontend");
    res.json(success({ accessToken: pair.accessToken }));
  };

  startGoogle = async (req: Request, res: Response) => {
    for (const [key, value] of this.states) if (value.expires <= Date.now()) this.states.delete(key);
    if (this.states.size >= 10000) throw new AppError(503, "Please retry later");
    const state = randomBytes(32).toString("hex");
    const url = this.auth.authorizationUrl(state);
    this.states.set(state, { expires: Date.now() + 600000, redirect: safeRedirectPath(req.query.redirectTo), swagger: req.query.target === "swagger", frontend: req.query.target === "frontend" });
    res.cookie("oauthState", state, { ...stateOptions, maxAge: 600000 });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(url);
  };

  callbackGoogle = async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const cookie = readCookie(req, "oauthState");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const session = cookie ? this.states.get(cookie) : undefined;
    if (cookie) this.states.delete(cookie);
    res.clearCookie("oauthState", stateOptions);
    const valid = cookie && /^[a-f0-9]{64}$/.test(state) && cookie.length === state.length
      && timingSafeEqual(Buffer.from(cookie), Buffer.from(state)) && session && session.expires > Date.now();
    if (!valid) return this.fail(res, "INVALID_STATE", session?.swagger, session?.redirect);
    if (req.query.error) return this.fail(res, req.query.error === "access_denied" ? "ACCESS_DENIED" : "AUTH_FAILED", session.swagger, session.redirect);
    if (typeof req.query.code !== "string" || !req.query.code) return this.fail(res, "AUTH_FAILED", session.swagger, session.redirect);
    try {
      const pair = await this.auth.completeGoogleLogin(req.query.code);
      this.setRefresh(res, pair.refreshToken, session.frontend);
      res.redirect(session.swagger ? "/api-docs/?login=success" : new URL(session.redirect, config.frontendUrl).toString());
    } catch (error) {
      logServerError("google_login_failed", error);
      this.fail(res, "AUTH_FAILED", session.swagger, session.redirect);
    }
  };

  private fail(res: Response, reason: string, swagger = false, redirect?: string) {
    const target = new URL(redirect ?? "/auth/error", config.frontendUrl);
    target.searchParams.set("reason", reason);
    res.redirect(swagger ? `/api-docs/?login=${reason}` : target.toString());
  }
  private setRefresh(res: Response, token: string, frontend = false) { res.cookie(frontend ? "frontendRefreshToken" : "refreshToken", token, { ...refreshOptions, maxAge: refreshMaxAge }); }
  private checkOrigin(req: Request) {
    const origins = [new URL(config.frontendUrl).origin, new URL(config.googleCallbackUrl).origin];
    if ((req.headers.origin ? !origins.includes(req.headers.origin) : req.headers["sec-fetch-site"] === "cross-site")) {
      throw new AppError(403, "Untrusted request origin");
    }
  }
  refresh = async (req: Request, res: Response) => {
    this.checkOrigin(req);
    res.setHeader("Cache-Control", "no-store");
    const frontend = req.query?.target === "frontend";
    const pair = await this.auth.refresh(readCookie(req, frontend ? "frontendRefreshToken" : "refreshToken"));
    this.setRefresh(res, pair.refreshToken, frontend);
    res.json(success({ accessToken: pair.accessToken }));
  };
  logout = async (req: Request, res: Response) => {
    this.checkOrigin(req);
    const cookieName = req.query?.target === "frontend" ? "frontendRefreshToken" : "refreshToken";
    res.setHeader("Cache-Control", "no-store");
    try {
      await this.auth.logout(readCookie(req, cookieName));
    } finally {
      res.clearCookie(cookieName, refreshOptions);
    }
    res.json(success(null));
  };
  me = async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(success(await this.auth.me(req.userId!)));
  };
}
