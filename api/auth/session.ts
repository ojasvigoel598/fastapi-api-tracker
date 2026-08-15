import * as jose from "jose";
import { env } from "../lib/env";

const JWT_ALG = "HS256";

export type SessionPayload = {
  userId: number;
  email: string;
};

/**
 * Sign the application session token. This is independent of any OAuth
 * provider: the app always issues its own cookie after verifying credentials.
 */
export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = new TextEncoder().encode(env.sessionSecret);
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.sessionSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { userId, email } = payload;
    if (typeof userId !== "number" || typeof email !== "string") return null;
    return { userId, email };
  } catch {
    return null;
  }
}

export type SupabaseClaims = {
  sub: string;
  email?: string;
};

/**
 * Verify a Supabase Auth access token (HS256, signed with the project's
 * JWT secret). Used only when Supabase mode is enabled.
 */
export async function verifySupabaseToken(
  token: string,
): Promise<SupabaseClaims | null> {
  if (!env.isSupabaseMode) return null;
  try {
    const secret = new TextEncoder().encode(env.supabaseJwtSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}
