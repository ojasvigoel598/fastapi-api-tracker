/**
 * Fixed-window in-memory rate limiter for authentication endpoints.
 *
 * Prevents credential brute-force / password spraying: after `maxHits`
 * failed attempts within `windowMs`, the key is blocked until the window
 * rolls over, and the caller is told how long to wait.
 *
 * This is per-process state. For a single-instance deployment that is
 * sufficient to stop brute-force. A horizontally scaled deployment should
 * back this with a shared store (e.g. Redis) so the counter is consistent
 * across replicas.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly maxHits: number;
  private readonly windowMs: number;

  constructor(maxHits: number, windowMs: number) {
    this.maxHits = maxHits;
    this.windowMs = windowMs;
  }

  /** Check whether `key` is currently allowed one more attempt. */
  check(key: string, now = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count >= this.maxHits) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Record a failed attempt and return whether the key is now blocked. */
  recordFailure(key: string, now = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      bucket.count += 1;
    }
    return this.check(key, now);
  }

  /** Clear the key (called after a successful authentication). */
  clear(key: string): void {
    this.buckets.delete(key);
  }

  /** Remove expired buckets so the map does not grow without bound. */
  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
