/**
 * Abuse-rate limiting for the non-authentication API surfaces.
 *
 * The auth routers already have their own brute-force limiters
 * (see ./auth-rate-limit.ts). This module guards the remaining surfaces
 * that are cheap to flood or expensive to run:
 *
 *   - webhook  : live telemetry ingest via a long-lived API key
 *   - replay   : re-firing a stored webhook delivery
 *   - kimi     : AI monitoring analysis (expensive upstream call)
 *   - seed     : bulk demo-data generation (5000-row inserts)
 *   - export   : CSV/JSON export of the request log
 *
 * Every limit is a fixed-window budget keyed per identity (user or API key)
 * and per source IP. Limits are configurable via environment variables so an
 * operator can tune them without a deploy:
 *
 *   RATE_LIMIT_WEBHOOK_PER_MIN  (default 600)
 *   RATE_LIMIT_REPLAY_PER_MIN   (default 30)
 *   RATE_LIMIT_KIMI_PER_HOUR    (default 10)
 *   RATE_LIMIT_SEED_PER_HOUR    (default 5)
 *   RATE_LIMIT_EXPORT_PER_MIN   (default 30)
 *
 * The counters are in-memory per process — sufficient for a single-instance
 * deployment; a horizontally scaled deployment should back this with a
 * shared store (e.g. Redis).
 */

import { FixedWindowRateLimiter, type RateLimitResult } from "./rate-limit";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type ApiRateLimitName =
  | "webhook"
  | "replay"
  | "kimi"
  | "seed"
  | "export";

const WEBHOOK_MAX = int("RATE_LIMIT_WEBHOOK_PER_MIN", 600);
const REPLAY_MAX = int("RATE_LIMIT_REPLAY_PER_MIN", 30);
const KIMI_MAX = int("RATE_LIMIT_KIMI_PER_HOUR", 10);
const SEED_MAX = int("RATE_LIMIT_SEED_PER_HOUR", 5);
const EXPORT_MAX = int("RATE_LIMIT_EXPORT_PER_MIN", 30);

const limiters: Record<
  ApiRateLimitName,
  { limiter: FixedWindowRateLimiter; windowMs: number }
> = {
  webhook: { limiter: new FixedWindowRateLimiter(WEBHOOK_MAX, MINUTE_MS), windowMs: MINUTE_MS },
  replay: { limiter: new FixedWindowRateLimiter(REPLAY_MAX, MINUTE_MS), windowMs: MINUTE_MS },
  kimi: { limiter: new FixedWindowRateLimiter(KIMI_MAX, HOUR_MS), windowMs: HOUR_MS },
  seed: { limiter: new FixedWindowRateLimiter(SEED_MAX, HOUR_MS), windowMs: HOUR_MS },
  export: { limiter: new FixedWindowRateLimiter(EXPORT_MAX, MINUTE_MS), windowMs: MINUTE_MS },
};

/** Best-effort client IP from the standard forwarded header. */
export function requestIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Consume one unit from the named budget for `identityKey` (e.g. `user:42`
 * or `key:7`). Returns whether the call is allowed and how long to wait if
 * not. Expired buckets are pruned opportunistically so the map stays small.
 */
export function consumeApiLimit(
  name: ApiRateLimitName,
  identityKey: string,
  ip: string,
  now = Date.now(),
): RateLimitResult {
  const { limiter } = limiters[name];
  limiter.prune(now);
  const byIdentity = limiter.consume(`${name}:${identityKey}`, now);
  if (!byIdentity.allowed) return byIdentity;
  return limiter.consume(`${name}:ip:${ip}`, now);
}

/** Human-readable budget description, useful for error messages. */
export function apiLimitLabel(name: ApiRateLimitName): string {
  switch (name) {
    case "webhook":
      return `${WEBHOOK_MAX} requests per minute`;
    case "replay":
      return `${REPLAY_MAX} replays per minute`;
    case "kimi":
      return `${KIMI_MAX} analyses per hour`;
    case "seed":
      return `${SEED_MAX} generations per hour`;
    case "export":
      return `${EXPORT_MAX} exports per minute`;
  }
}
