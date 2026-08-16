import type { PoolOptions } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

/**
 * Build mysql2 pool options from a `mysql://` URL, honouring the TLS and
 * pool options both major free providers ship in their connection strings.
 * TiDB Cloud and Aiven both require TLS and hand out URLs with
 * `?ssl-mode=REQUIRED`.
 *
 *   ?ssl-mode=REQUIRED       → encrypt, don't verify the CA
 *   ?ssl-mode=VERIFY_CA      → encrypt + verify the CA chain
 *   ?ssl-mode=VERIFY_IDENTITY→ encrypt + verify CA + hostname
 *   ?ssl-mode=DISABLED       → no TLS
 *   ?connectionLimit=N       → pool size (Aiven's free tier caps at 76)
 *
 * mysql2's own URL parser ignores `ssl-mode` entirely — it would connect
 * with ssl:false and log a warning. Without this parsing, pasting a hosted
 * connection string into DATABASE_URL silently connects unencrypted, and
 * TiDB/Aiven reject non-TLS connections outright.
 */
export function poolOptionsFromUrl(url: string): PoolOptions {
  const u = new URL(url);
  const options: PoolOptions = {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };

  const sslMode = u.searchParams.get("ssl-mode")?.toUpperCase();
  if (sslMode && sslMode !== "DISABLED") {
    options.ssl =
      sslMode === "VERIFY_CA" || sslMode === "VERIFY_IDENTITY"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false };
  }

  const limit = u.searchParams.get("connectionLimit");
  if (limit) {
    const n = Number(limit);
    if (Number.isInteger(n) && n > 0) {
      options.connectionLimit = n;
    }
  }

  return options;
}

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    // Standard MySQL via mysql2. The legacy "planetscale" mode existed for
    // PlanetScale's serverless driver (it disabled lateral subqueries), but
    // PlanetScale discontinued its MySQL hosting, so a real MySQL instance
    // uses the default mode. TLS/pool options come from the URL (see
    // poolOptionsFromUrl), so hosted free-tier connection strings work.
    instance = drizzle({
      connection: poolOptionsFromUrl(env.databaseUrl),
      mode: "default",
      schema: fullSchema,
    });
  }
  return instance;
}
