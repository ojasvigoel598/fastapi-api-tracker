/**
 * Retry helpers for the migration runner.
 *
 * A freshly-provisioned TiDB Cloud Serverless cluster (or a waking Aiven
 * free instance) can take tens of seconds to accept connections after the
 * marketplace integration sets DATABASE_URL — so the first deploy would
 * otherwise fail on a transient connection error. These helpers classify
 * transient failures and compute backoff delays; the migrator retries them
 * before giving up.
 */

const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPROTO",
  "EADDRNOTAVAIL",
  "EAGAIN",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_CON_COUNT_ERROR",
]);

/**
 * Whether an error is worth retrying. Authentication failures
 * (ER_ACCESS_DENIED_ERROR), unknown databases, SQL syntax errors and other
 * deterministic failures are NOT transient and must fail fast.
 */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    // mysql2 maps "could not connect" to `ECONNREFUSED`/`ETIMEDOUT`; the
    // error text may also carry the underlying code.
    if (TRANSIENT_CODES.has(code)) return true;
    // MySQL error numbers: 1040 (too many connections) and 1042 (can't get
    // hostname) are transient; 1045 (access denied) is not.
    const num = Number(code);
    if (Number.isInteger(num)) {
      if (num === 1040 || num === 1042) return true;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return /temporarily|too many connections|connection (refused|lost|reset)|timed? ?out|eai_again|getaddrinfo/i.test(
    message,
  );
}

/** Exponential backoff with full jitter: [0, base * 2^attempt). */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const cap = Math.min(baseMs * 2 ** Math.min(attempt, 30), maxMs);
  return Math.floor(Math.random() * cap);
}

/** Defaults, overridable via env for tight CI loops. */
export function retrySettings(env: NodeJS.ProcessEnv): {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
} {
  const maxRetries = Math.max(0, Number(env.MIGRATE_MAX_RETRIES ?? 8) || 0);
  const baseDelayMs = Math.max(100, Number(env.MIGRATE_BASE_DELAY_MS ?? 2000) || 2000);
  const maxDelayMs = Math.max(baseDelayMs, Number(env.MIGRATE_MAX_DELAY_MS ?? 30000) || 30000);
  return { maxRetries, baseDelayMs, maxDelayMs };
}
