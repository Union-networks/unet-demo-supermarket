import { createHmac, timingSafeEqual } from "node:crypto";
import { PostgresDirectLoginAccountStore } from "@u-net/server";
import { providerPool } from "./provider-db";
import { PUBLIC_SITE_ORIGIN, SERVICE_ID } from "./config";

export const PROVIDER_SESSION_COOKIE = "unet_supermarket_session";
const SECURITY_EPOCH = "cookie-bound-login-2026-09";
const audience = () => `${SERVICE_ID}@${new URL(PUBLIC_SITE_ORIGIN).origin}`;

function secret() {
  const value = process.env.UNET_PROVIDER_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("UNET_PROVIDER_SESSION_SECRET must contain at least 32 characters");
  return value;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createProviderSession(scopedUserId: string) {
  const payload = Buffer.from(JSON.stringify({ scopedUserId, securityEpoch: SECURITY_EPOCH, audience: audience(), expiresAt: Date.now() + 15 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export async function readProviderSession(request: Request): Promise<{ scopedUserId: string } | null> {
  const cookies = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${PROVIDER_SESSION_COOKIE}=`));
  if (cookies?.length !== 1) return null;
  const token = cookies[0].slice(PROVIDER_SESSION_COOKIE.length + 1);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value.securityEpoch !== SECURITY_EPOCH || value.audience !== audience() || typeof value.scopedUserId !== "string" || !value.scopedUserId
      || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    // Never cache this lookup: retirement invalidates even an unexpired cookie.
    const key = await new PostgresDirectLoginAccountStore(providerPool).getPublicKey(value.scopedUserId);
    return key ? { scopedUserId: value.scopedUserId } : null;
  } catch {
    return null;
  }
}

export const providerSessionCookie = (token = "", maxAge = 15 * 60) =>
  `${PROVIDER_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
