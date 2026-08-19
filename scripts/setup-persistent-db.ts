/**
 * One-command local setup for a persistent database.
 *
 * Takes a MySQL connection string (TiDB Cloud Serverless or Aiven free
 * tier — both work, ssl-mode is honoured), verifies it is reachable,
 * applies the Drizzle migrations, and writes `.env.local` with
 * DATABASE_URL (plus a freshly generated APP_SECRET) so `npm run dev`
 * serves real storage instead of the in-memory demo.
 *
 * Usage:
 *   MYSQL_URL="mysql://user:pass@host:4000/db?ssl-mode=REQUIRED" npm run db:setup
 *
 * Or read the URL from DATABASE_URL instead of MYSQL_URL. Re-running is
 * safe: migrations only apply pending steps and APP_SECRET is only
 * generated when missing. `.env.local` is gitignored, so secrets never
 * reach version control.
 */
import "dotenv/config";
import { config as loadEnvFile } from "dotenv";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import {
  backoffDelayMs,
  isTransientError,
  retrySettings,
} from "./migrate-helpers";

// Mirror api/lib/env.ts: the Keys tab writes values to .env.local.
loadEnvFile({ path: ".env.local" });

const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "[db:setup] MYSQL_URL is required, e.g.\n" +
      "  MYSQL_URL=\"mysql://user:pass@host:4000/db?ssl-mode=REQUIRED\" npm run db:setup",
  );
  process.exit(1);
}

// Parse the URL into connection options (same rules as the app's
// poolOptionsFromUrl: ssl-mode=REQUIRED / VERIFY_CA / VERIFY_IDENTITY /
// DISABLED, connectionLimit=N).
const u = new URL(url);
if (u.protocol !== "mysql:") {
  console.error(`[db:setup] expected a mysql:// URL, got ${u.protocol}//`);
  process.exit(1);
}
const options: mysql.PoolOptions = {
  host: u.hostname,
  port: Number(u.port || 3306),
  user: decodeURIComponent(u.username || "root"),
  password: decodeURIComponent(u.password || ""),
  database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "mysql",
};
const sslMode = u.searchParams.get("ssl-mode")?.toUpperCase();
if (sslMode && sslMode !== "DISABLED") {
  options.ssl =
    sslMode === "VERIFY_CA" || sslMode === "VERIFY_IDENTITY"
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: false };
}

const { maxRetries, baseDelayMs, maxDelayMs } = retrySettings(process.env);
console.log(
  `[db:setup] connecting to ${options.host}:${options.port}/${options.database} (ssl: ${options.ssl ? "on" : "off"})` +
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
    console.log("[db:setup] migrations applied");
    lastError = undefined;
    break;
  } catch (err) {
    lastError = err;
    if (attempt === maxRetries || !isTransientError(err)) {
      break;
    }
    const delay = backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(
      `[db:setup] attempt ${attempt + 1}/${maxRetries + 1} failed (transient: ${detail}) — retrying in ${Math.round(delay)}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
if (lastError) {
  const detail =
    lastError instanceof Error ? lastError.message.split("\n")[0] : String(lastError);
  console.error(`[db:setup] FAILED — could not connect/migrate: ${detail}`);
  console.error(
    "Check the connection string. TiDB/Aiven: keep ?ssl-mode=REQUIRED; allowlist this IP if the provider enforces one.",
  );
  process.exit(1);
}

// ── Write .env.local (merge, never clobber unrelated keys) ─────────────
const existing: Record<string, string> = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) existing[m[1]] = m[2];
  }
} catch {
  // no .env.local yet — start fresh
}
const secret = existing.APP_SECRET || randomBytes(32).toString("hex");
const next: Record<string, string> = {
  ...existing,
  DATABASE_URL: url,
  APP_SECRET: secret,
};
const body =
  Object.entries(next)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
writeFileSync(".env.local", body);
console.log("[db:setup] wrote .env.local (DATABASE_URL + APP_SECRET) — gitignored");

console.log("\n✅ Persistent database wired up. Next:");
console.log("  npm run dev        # preview now serves REAL storage (health reports mode=production)");
console.log("  npm test           # unit tests (demo store, unaffected)");
console.log("  MYSQL_E2E_URL=\"$MYSQL_URL\" npm run db:e2e   # full real-MySQL harness against this DB");
