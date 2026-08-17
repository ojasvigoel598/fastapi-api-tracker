/**
 * Programmatic Drizzle migration runner.
 *
 * Applies ./db/migrations to the MySQL database named by DATABASE_URL —
 * the same migrations the e2e harness and the Docker compose stack use.
 * Unlike `drizzle-kit migrate`, this runs anywhere tsx runs (CI, Vercel
 * build, one-off script) with no interactive prompts, and it fails with a
 * clear exit code when the database is unreachable.
 *
 * Usage:
 *   DATABASE_URL="mysql://user:pass@host:3306/db" npm run db:migrate:run
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

// Mirror api/lib/env.ts: the Keys tab writes values to .env.local, and
// drizzle.config.ts reads both files too.
loadEnvFile({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const options = poolOptionsFromUrl(url);
console.log(
  `[migrate] connecting to ${options.host}:${options.port}/${options.database} (ssl: ${options.ssl ? "on" : "off"})`,
);

const conn = await mysql.createConnection({ ...options, multipleStatements: true });
try {
  const db = drizzle(conn, { mode: "default" });
  await migrate(db, { migrationsFolder: "./db/migrations" });
  console.log("[migrate] migrations applied");
} finally {
  await conn.end();
}
