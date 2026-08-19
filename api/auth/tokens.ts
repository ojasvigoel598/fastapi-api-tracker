/**
 * One-time security tokens for email verification and password reset.
 *
 * Tokens are 32 random bytes (256 bits of entropy) returned to the user in
 * the email link; only the SHA-256 digest is stored, so a database leak never
 * reveals usable tokens. Every token is single-use (cleared after a
 * successful verification/reset) and short-lived.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A verification link is valid for 1 hour. */
export const VERIFICATION_TTL_MS = 60 * 60 * 1000;
/** A password-reset link is valid for 30 minutes. */
export const RESET_TTL_MS = 30 * 60 * 1000;

/** Generate a fresh 64-character hex token (32 random bytes). */
export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hex digest — the only form of a token ever persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True when the stored digest matches and the expiry is still in the future. */
export function tokenValid(
  storedHash: string | null | undefined,
  expiresAt: Date | null | undefined,
  token: string,
  now = new Date(),
): boolean {
  if (!storedHash || !expiresAt) return false;
  if (expiresAt.getTime() <= now.getTime()) return false;
  const digest = hashToken(token);
  // Constant-time comparison so timing cannot leak a partial match.
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify-then-clear helper: when the token is valid, the caller clears the
 * stored fields immediately (single use). Returns whether the token was valid.
 */
export function consumeToken(
  storedHash: string | null | undefined,
  expiresAt: Date | null | undefined,
  token: string,
  now = new Date(),
): boolean {
  return tokenValid(storedHash, expiresAt, token, now);
}
