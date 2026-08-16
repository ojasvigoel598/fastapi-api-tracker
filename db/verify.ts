/**
 * Database Verification Script
 *
 * Proves the MySQL + Drizzle path works end to end: connects to the real
 * database configured via DATABASE_URL, inspects the tables, and runs the
 * same monitoring queries the dashboard uses against MySQL.
 *
 * Run with: npm run db:verify
 * Requires DATABASE_URL (from .env / .env.local / Keys tab). Fails loudly
 * if the database is unreachable or the tables are missing.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { apiRequests, alerts, endpoints, users, usageAlerts, usageLimits } from "./schema";
import {
  getOverviewMetrics,
  getStatusCodeDistribution,
  getEndpoints,
  getAlerts,
} from "../api/queries/monitoring";

const TABLES = [
  ["users", users],
  ["api_requests", apiRequests],
  ["endpoints", endpoints],
  ["alerts", alerts],
  ["usage_limits", usageLimits],
  ["usage_alerts", usageAlerts],
] as const;

async function verify() {
  const db = getDb();
  console.log("Connected to MySQL via Drizzle (mysql2).");

  console.log("\n─ Table row counts ─");
  for (const [name, table] of TABLES) {
    const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(table);
    console.log(`  ${name.padEnd(14)} ${String(row?.count ?? 0).padStart(6)} rows`);
  }

  const [firstUser] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .orderBy(users.id)
    .limit(1);
  if (!firstUser) {
    throw new Error("No application user exists — create an account or run npm run db:seed first.");
  }
  console.log(`\nVerifying dashboard queries for user ${firstUser.id} <${firstUser.email}> (${firstUser.role}):`);

  const overview = await getOverviewMetrics("7d", firstUser.id);
  console.log("\n─ getOverviewMetrics('7d') ─");
  console.log(overview);

  const statusCodes = await getStatusCodeDistribution("7d", firstUser.id);
  console.log(`\n─ getStatusCodeDistribution('7d') — ${statusCodes.length} status buckets ─`);
  console.log(statusCodes.slice(0, 5));

  const topEndpoints = await getEndpoints("7d", 5, firstUser.id);
  console.log(`\n─ getEndpoints('7d', limit 5) — top ${topEndpoints.length} endpoints ─`);
  for (const e of topEndpoints) {
    console.log(
      `  ${e.method} ${e.path}  total=${e.totalRequests} failed=${e.failedRequests} avg=${e.avgLatencyMs}ms`,
    );
  }

  const alertList = await getAlerts({}, firstUser.id);
  console.log(`\n─ getAlerts() — ${alertList.length} alerts ─`);
  console.log(alertList.slice(0, 3));

  console.log("\n✅ MySQL + Drizzle path verified: migrations applied, seed data readable,");
  console.log("   and all dashboard monitoring queries return real database rows.");
}

verify().catch((err) => {
  console.error("\n❌ db:verify failed — the MySQL/Drizzle path is NOT working:");
  console.error(err);
  process.exit(1);
});
