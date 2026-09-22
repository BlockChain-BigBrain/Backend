import { AppError } from "../utils/errors";

export interface LogInRequest { email: string; password: string; }
export interface SignUpRequest extends LogInRequest { nickname: string; preferredLanguage?: string; }

export function validateCredentials(body: unknown, signup: true): SignUpRequest;
export function validateCredentials(body: unknown, signup?: false): LogInRequest;
export function validateCredentials(body: unknown, signup = false): LogInRequest | SignUpRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "요청 본문이 올바르지 않습니다.");
  const input = body as Record<string, unknown>;
  const allowed = signup ? ["email", "password", "nickname", "preferredLanguage"] : ["email", "password"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AppError(400, "허용되지 않은 입력 필드입니다.");
  if (typeof input.email !== "string" || input.email.trim().length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new AppError(400, "올바른 이메일을 입력해 주세요.");
  }
  if (typeof input.password !== "string" || input.password.length < (signup ? 8 : 1) || Buffer.byteLength(input.password) > 72) {
    throw new AppError(400, "비밀번호는 가입 시 8자 이상, 최대 72바이트여야 합니다.");
  }
  const credentials = { email: input.email, password: input.password };
  if (!signup) return credentials;
  if (typeof input.nickname !== "string" || input.nickname.trim().length < 2 || input.nickname.trim().length > 20) {
    throw new AppError(400, "닉네임은 2~20자로 입력해 주세요.");
  }
  if (input.preferredLanguage !== undefined && !["ko", "en", "zh"].includes(input.preferredLanguage as string)) {
    throw new AppError(400, "지원하지 않는 언어입니다.");
  }
  return { ...credentials, nickname: input.nickname, preferredLanguage: input.preferredLanguage as string | undefined };
}
