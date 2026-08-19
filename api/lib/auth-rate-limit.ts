/**
 * Authentication rate limiting.
 *
 * Two independent fixed windows share the same 15-minute period:
 *  - per-account: blocks repeated guesses against a single email address
 *    (credential brute-force),
 *  - per-IP: caps total failed attempts from one source (password spraying
 *    across many accounts).
 *
 * The limiter is shared module state, so it applies identically in demo mode
 * and in the MySQL-backed deployment (per process). Successful authentication
 * clears the account bucket, so a legitimate sign-in is never locked out by
 * its own past failures.
 */

import { FixedWindowRateLimiter } from "./rate-limit";

export const AUTH_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 20;

export const VERIFY_TOKEN_MAX_ATTEMPTS = 10;
export const RESET_REQUEST_MAX = 3;

export const accountLimiter = new FixedWindowRateLimiter(
  ACCOUNT_MAX_FAILURES,
  AUTH_WINDOW_MS,
);
export const ipLimiter = new FixedWindowRateLimiter(IP_MAX_FAILURES, AUTH_WINDOW_MS);

/**
 * Brute-force guard for the one-time token endpoints (email verification,
 * resend, password reset): an attacker guessing tokens is limited per IP.
 */
export const tokenAttemptLimiter = new FixedWindowRateLimiter(
  VERIFY_TOKEN_MAX_ATTEMPTS,
  AUTH_WINDOW_MS,
);

/**
 * Rate limit for password-reset *requests*: per account+IP so a victim's
 * inbox cannot be flooded with reset emails.
 */
export const resetRequestLimiter = new FixedWindowRateLimiter(
  RESET_REQUEST_MAX,
  AUTH_WINDOW_MS,
);

/** Best-effort client IP from the standard forwarded header. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function accountKey(email: string): string {
  return `email:${email.toLowerCase().trim()}`;
}

/**
 * Return a blocking result when the account or the source IP is currently
 * over its failure budget, otherwise null.
 */
export function checkAuthRateLimit(
  email: string,
  ip: string,
): { retryAfterSeconds: number } | null {
  const account = accountLimiter.check(accountKey(email));
  if (!account.allowed) return { retryAfterSeconds: account.retryAfterSeconds };

  const source = ipLimiter.check(`ip:${ip}`);
  if (!source.allowed) return { retryAfterSeconds: source.retryAfterSeconds };

  return null;
}

export function recordAuthFailure(email: string, ip: string): void {
  accountLimiter.recordFailure(accountKey(email));
  ipLimiter.recordFailure(`ip:${ip}`);
}

export function clearAuthFailures(email: string): void {
  accountLimiter.clear(accountKey(email));
}

/** Blocking result when the source IP has spent its one-time-token budget. */
export function checkTokenAttemptLimit(ip: string): {
  retryAfterSeconds: number;
} | null {
  const result = tokenAttemptLimiter.check(`ip:${ip}`);
  return result.allowed ? null : { retryAfterSeconds: result.retryAfterSeconds };
}

/** Record one one-time-token attempt (verify/resend/reset-confirm). */
export function recordTokenAttempt(ip: string): void {
  tokenAttemptLimiter.recordFailure(`ip:${ip}`);
}

/** Blocking result when an account+IP has spent its reset-request budget. */
export function checkResetRequestLimit(email: string, ip: string): {
  retryAfterSeconds: number;
} | null {
  const result = resetRequestLimiter.check(`${accountKey(email)}:${ip}`);
  return result.allowed ? null : { retryAfterSeconds: result.retryAfterSeconds };
}

/** Record one password-reset request for an account+IP. */
export function recordResetRequest(email: string, ip: string): void {
  resetRequestLimiter.recordFailure(`${accountKey(email)}:${ip}`);
}
