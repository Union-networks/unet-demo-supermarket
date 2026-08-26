import { createHmac, timingSafeEqual } from "node:crypto";

export const PROVIDER_SESSION_COOKIE = "unet_supermarket_session";

function secret() {
  const value = process.env.UNET_PROVIDER_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("UNET_PROVIDER_SESSION_SECRET must contain at least 32 characters");
  return value;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createProviderSession(scopedUserId: string) {
  const payload = Buffer.from(JSON.stringify({ scopedUserId, expiresAt: Date.now() + 15 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readProviderSession(request: Request): { scopedUserId: string } | null {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${PROVIDER_SESSION_COOKIE}=`))?.slice(PROVIDER_SESSION_COOKIE.length + 1);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { scopedUserId?: string; expiresAt?: number };
    return value.scopedUserId && Number(value.expiresAt) > Date.now() ? { scopedUserId: value.scopedUserId } : null;
  } catch {
    return null;
  }
}

export const providerSessionCookie = (token = "", maxAge = 15 * 60) =>
  `${PROVIDER_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
