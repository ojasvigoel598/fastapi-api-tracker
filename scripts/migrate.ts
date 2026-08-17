/**
 * Programmatic Drizzle migration runner.
 *
 * Applies ./db/migrations to the MySQL database named by DATABASE_URL —
 * the same migrations the e2e harness and the Docker compose stack use.
 * Unlike `drizzle-kit migrate`, this runs anywhere tsx runs (CI, Vercel
 * build, one-off script) with no interactive prompts, and it fails with a
 * clear exit code when the database is unreachable.
 *
 * A freshly-provisioned TiDB Cloud Serverless cluster (or a waking Aiven
 * free instance) can take tens of seconds to accept connections after the
 * marketplace integration sets DATABASE_URL. Transient connection errors
 * (refused / timeout / DNS) are retried with exponential backoff + jitter
 * before giving up — deterministic failures (bad credentials, unknown
 * database, SQL errors) fail immediately.
 *
 * Usage:
 *   DATABASE_URL="mysql://user:pass@host:3306/db" npm run db:migrate:run
 *
 * Tuning (env): MIGRATE_MAX_RETRIES (default 8), MIGRATE_BASE_DELAY_MS
 * (default 2000), MIGRATE_MAX_DELAY_MS (default 30000).
 *
 * Drizzle tracks applied migrations in `__drizzle_migrations`, so running
 * this repeatedly is safe (pending migrations only).
 */
import "dotenv/config";
import { config as loadEnvFile } from "dotenv";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { poolOptionsFromUrl } from "../api/queries/connection";
import {
  backoffDelayMs,
  isTransientError,
  retrySettings,
} from "./migrate-helpers";

// Mirror api/lib/env.ts: the Keys tab writes values to .env.local, and
// drizzle.config.ts reads both files too.
loadEnvFile({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const { maxRetries, baseDelayMs, maxDelayMs } = retrySettings(process.env);
const options = poolOptionsFromUrl(url);
console.log(
  `[migrate] connecting to ${options.host}:${options.port}/${options.database} (ssl: ${options.ssl ? "on" : "off"})` +
    (maxRetries > 0 ? `, retrying up to ${maxRetries}x on transient errors` : ""),
);

async function runOnce(): Promise<void> {
  const conn = await mysql.createConnection({ ...options, multipleStatements: true });
  try {
    const db = drizzle(conn, { mode: "default" });
    await migrate(db, { migrationsFolder: "./db/migrations" });
  } finally {
    await conn.end();
  }
}

let lastError: unknown;
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    await runOnce();
    console.log("[migrate] migrations applied");
    process.exit(0);
  } catch (err) {
    lastError = err;
    if (attempt === maxRetries || !isTransientError(err)) {
      break;
    }
    const delay = backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(
      `[migrate] attempt ${attempt + 1}/${maxRetries + 1} failed (transient: ${detail}) — retrying in ${Math.round(delay)}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

if (lastError instanceof Error) {
  console.error(`[migrate] FAILED after ${maxRetries + 1} attempts: ${lastError.message.split("\n")[0]}`);
} else {
  console.error(`[migrate] FAILED after ${maxRetries + 1} attempts`);
}
process.exit(1);
