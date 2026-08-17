/**
 * Real-MySQL end-to-end harness.
 *
 * Proves the DATABASE_URL path works against an actual MySQL server:
 * applies the Drizzle migrations, boots the app in-process against the
 * database, then drives it with the exact same @trpc/client + superjson
 * stack the frontend uses. Finally verifies the webhook-ingested rows are
 * persisted directly in MySQL.
 *
 * By default it starts an ephemeral real MySQL server (mysql-memory-server
 * downloads the actual MySQL binaries). To run against an existing server
 * (e.g. a GitHub Actions `services:` container), set MYSQL_E2E_URL:
 *
 *   MYSQL_E2E_URL="mysql://user:pass@host:3306/dbname" npm run db:e2e
 *
 * Run: npm run db:e2e
 */
import { createDB } from "mysql-memory-server";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../api/router";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`[mysql-e2e] FAIL: ${msg}`);
  }
}

// ── 1) Obtain a real MySQL server ──────────────────────────────────────
let server: Awaited<ReturnType<typeof createDB>> | null = null;
let cfg: { host: string; port: number; user: string; password: string; database: string };

const externalUrl = process.env.MYSQL_E2E_URL;
if (externalUrl) {
  const u = new URL(externalUrl);
  cfg = {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username || "root"),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "mysql",
  };
  console.log(
    `[mysql-e2e] using external MySQL: ${cfg.host}:${cfg.port}/${cfg.database} (user=${cfg.user})`,
  );
} else {
  server = await createDB();
  cfg = {
    host: "127.0.0.1",
    port: server.port,
    user: server.username,
    password: "",
    database: server.dbName,
  };
  console.log(
    `[mysql-e2e] ephemeral MySQL up: ${cfg.host}:${cfg.port}/${cfg.database} (user=${cfg.user}, pwd='')`,
  );
}

// ── 2) Apply real migrations ───────────────────────────────────────────
const conn = await mysql.createConnection({
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  multipleStatements: true,
});
await migrate(drizzle(conn, { mode: "default" }), { migrationsFolder: "./db/migrations" });
console.log("[mysql-e2e] migrations applied");

// Inspect the real schema so we can assert against it later.
const [tables] = (await conn.query("SHOW TABLES")) as unknown as Array<Record<string, string>>;
const tableNames = tables.map((r) => Object.values(r)[0]);
console.log("[mysql-e2e] tables:", tableNames.join(", "));
for (const t of ["users", "api_requests", "alerts", "api_keys"]) {
  assert(tableNames.includes(t), `table '${t}' missing after migration`);
}
await conn.end();

// ── 3) Boot the app against the real database ──────────────────────────
process.env.DATABASE_URL = `mysql://${cfg.user}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}/${cfg.database}`;
process.env.APP_SECRET = "mysql-e2e-test-secret-0123456789";
process.env.NODE_ENV = "production";
process.env.VERCEL = "1"; // skip long-lived serve(); drive app.fetch directly

const { default: app } = await import("../api/boot");
assert(app, "app failed to boot");

// Route the client's fetch() into app.fetch so the exact frontend stack
// (httpBatchLink + superjson) talks to the in-process app.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    return app.fetch(req);
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── 4) Health ──────────────────────────────────────────────────────────
const healthResp = await fetch("http://localhost/api/health"); // routed to app.fetch by the override
assert(healthResp.status === 200, `health status ${healthResp.status}`);
const health = await healthResp.json();
console.log(`[mysql-e2e] /api/health -> ${healthResp.status} (mode=${health.mode})`);
assert(health.mode === "production", `expected production mode, got ${health.mode}`);

// ── 5) Register a real user in MySQL ───────────────────────────────────
// NOTE: in tRPC v11 the transformer is a LINK option, exactly like the
// frontend's src/providers/trpc.tsx — passing it top-level silently disables
// input serialization and the server rejects the input.
const client = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: "http://localhost/api/trpc", transformer: superjson })],
});

const email = `mysql-e2e-${Date.now()}@example.com`;
const registerRes = await client.auth.register.mutate({
  email,
  password: "password123",
  name: "MySQL E2E",
});
assert(registerRes?.user?.id, "register did not return a user");
assert(registerRes?.token, "register did not return a session token");
const userId: number = registerRes.user.id;
console.log(`[mysql-e2e] registered user id=${userId} email=${email}`);

// Use the token as the frontend does (Authorization: Bearer).
const authed = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost/api/trpc",
      transformer: superjson,
      headers: () => ({ authorization: `Bearer ${registerRes.token}` }),
    }),
  ],
});

const me = await authed.auth.me.query();
assert(me?.id === userId, `auth.me mismatch: ${JSON.stringify(me)}`);
console.log(`[mysql-e2e] auth.me -> id=${me.id} email=${me.email} (role=${me.role})`);

// ── 6) Seed 1500 logs + alerts via the real seed path ──────────────────
process.env.SEED_USER_ID = String(userId);
await import("../db/seed");
// The seed is fire-and-forget; poll the overview until rows land, then settle
// until two consecutive reads agree so the background seed is fully done.
let overview0: Awaited<ReturnType<typeof authed.monitoring.overview.query>> | null = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const a = await authed.monitoring.overview.query({ timeRange: "7d" });
  if (a.totalRequests < 1500) continue;
  await new Promise((r) => setTimeout(r, 500));
  const b = await authed.monitoring.overview.query({ timeRange: "7d" });
  if (a.totalRequests === b.totalRequests) {
    overview0 = b;
    break;
  }
}
assert(overview0, "seed never reached a stable 1500 rows within the poll window");
console.log(
  `[mysql-e2e] overview after seed: total=${overview0.totalRequests} endpoints=${overview0.activeEndpoints} p95=${overview0.p95LatencyMs}`,
);
assert(overview0.totalRequests >= 1500, `expected >=1500 requests, got ${overview0.totalRequests}`);

// Percentiles must be REAL numbers (this was the historic bug — hardcoded 0).
assert(overview0.p95LatencyMs > 0, `overview p95 is ${overview0.p95LatencyMs}`);

const endpoints0 = await authed.monitoring.endpoints.query({ timeRange: "7d", limit: 5 });
assert(endpoints0.length > 0, "endpoints returned empty");
const ep = endpoints0[0];
assert(
  ep.p50LatencyMs > 0 && ep.p95LatencyMs > 0 && ep.p99LatencyMs > 0,
  `endpoint percentiles zero: p50=${ep.p50LatencyMs} p95=${ep.p95LatencyMs} p99=${ep.p99LatencyMs}`,
);
console.log(
  `[mysql-e2e] endpoint percentiles real: p50=${ep.p50LatencyMs} p95=${ep.p95LatencyMs} p99=${ep.p99LatencyMs} (${ep.method} ${ep.path})`,
);

const series = await authed.monitoring.timeSeries.query({ timeRange: "7d", groupBy: "day" });
assert(series?.length > 0, "timeSeries empty");
console.log(`[mysql-e2e] timeSeries buckets: ${series.length}`);

// ── 7) Webhook key + ingest against real MySQL ─────────────────────────
const keyRes = await authed.webhooks.createKey.mutate({ name: "e2e-key" });
assert(keyRes?.key?.startsWith?.("apk_"), `createKey returned ${JSON.stringify(keyRes)}`);
const apiKey: string = keyRes.key;
console.log("[mysql-e2e] created webhook key (first 12 chars):", apiKey.slice(0, 12) + "…");

const single = await fetch("http://localhost/api/webhook/ingest", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    endpoint: "/api/v1/e2e-checkout",
    method: "POST",
    statusCode: 201,
    latencyMs: 87,
    responseSize: 640,
  }),
});
assert(single.status === 201, `single webhook ingest ${single.status}`);
const singleBody = (await single.json()) as { received?: Array<{ id: number }> };
assert(singleBody.received?.[0]?.id, "single ingest missing id");
console.log(`[mysql-e2e] webhook single -> 201 (id=${singleBody.received[0].id})`);

const batch = await fetch("http://localhost/api/webhook/ingest", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    events: [
      { endpoint: "/api/v1/e2e-checkout", method: "GET", statusCode: 200, latencyMs: 12, responseSize: 120 },
      { endpoint: "/api/v1/e2e-checkout", method: "GET", statusCode: 503, latencyMs: 940, responseSize: 40 },
      { endpoint: "/api/v1/e2e-orders", method: "POST", statusCode: 200, latencyMs: 45, responseSize: 300 },
    ],
  }),
});
assert(batch.status === 201, `batch webhook ingest ${batch.status}`);
console.log("[mysql-e2e] webhook batch -> 201 (3 events)");

// Bad key rejected
const bad = await fetch("http://localhost/api/webhook/ingest", {
  method: "POST",
  headers: { authorization: "Bearer apk_bogus", "content-type": "application/json" },
  body: JSON.stringify({ endpoint: "/x", method: "GET", statusCode: 200, latencyMs: 1 }),
});
assert(bad.status === 401, `bad-key ingest ${bad.status}`);
console.log("[mysql-e2e] bad-key webhook -> 401");

// ── 7b) RATE-LIMIT HARDENING: concurrent webhook ingests vs real MySQL ──
// Separate connection for direct SQL assertions in this section.
const check2 = await mysql.createConnection({
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
});

// Configure a hard daily limit on a fresh endpoint, then fire many webhook
// ingests at once. The MySQL path enforces atomically (row lock + transaction
// in api/queries/usage.ts), so exactly `limit` must pass and every excess
// request must be blocked — no over-counting, no deadlocks, no 500s.
const rlEndpoint = `/api/v1/e2e-rate-limit-${Date.now()}`;
const RL_LIMIT = 3;
const RL_ATTEMPTS = 12;
await authed.limits.save.mutate({
  endpoint: rlEndpoint,
  method: "GET",
  config: {
    dailyLimit: RL_LIMIT,
    monthlyLimit: null,
    costLimit: null,
    warningThreshold: 50,
    criticalThreshold: 80,
    emailAlerts: false,
    rateLimiting: true,
  },
});
console.log(
  `[mysql-e2e] rate limit ${RL_LIMIT}/day on ${rlEndpoint}; firing ${RL_ATTEMPTS} concurrent webhook ingests…`,
);

const rlResults = await Promise.all(
  Array.from({ length: RL_ATTEMPTS }, () =>
    fetch("http://localhost/api/webhook/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ endpoint: rlEndpoint, method: "GET", statusCode: 200, latencyMs: 5 }),
    }),
  ),
);
const statuses = rlResults.map((r) => r.status);
const allowed = statuses.filter((s) => s === 201).length;
const blocked = statuses.filter((s) => s === 429).length;
const unexpected = statuses.filter((s) => s !== 201 && s !== 429);
console.log(
  `[mysql-e2e] concurrent rate-limit results: ${allowed}×201, ${blocked}×429${unexpected.length ? `, UNEXPECTED ${unexpected.join(",")}` : ""}`,
);
assert(allowed === RL_LIMIT, `expected exactly ${RL_LIMIT} allowed, got ${allowed}`);
assert(blocked === RL_ATTEMPTS - RL_LIMIT, `expected ${RL_ATTEMPTS - RL_LIMIT} blocked, got ${blocked}`);
assert(unexpected.length === 0, `unexpected statuses: ${unexpected.join(",")}`);

// The blocked rows must exist in MySQL (blocked=1) and never count as usage.
const [rlRows] = (await check2.query(
  "SELECT blocked, COUNT(*) AS n FROM api_requests WHERE user_id = ? AND endpoint = ? GROUP BY blocked",
  [userId, rlEndpoint],
)) as unknown as Array<{ blocked: number; n: number | string }>;
const blockedCount = rlRows.find((r) => r.blocked === 1);
const unblockedCount = rlRows.find((r) => r.blocked === 0);
assert(
  Number(unblockedCount?.n ?? 0) === RL_LIMIT,
  `expected ${RL_LIMIT} non-blocked rows in MySQL, got ${unblockedCount?.n}`,
);
assert(
  Number(blockedCount?.n ?? 0) === RL_ATTEMPTS - RL_LIMIT,
  `expected ${RL_ATTEMPTS - RL_LIMIT} blocked rows in MySQL, got ${blockedCount?.n}`,
);
const [usageRow] = (await check2.query(
  "SELECT COUNT(*) AS n FROM api_requests WHERE user_id = ? AND endpoint = ? AND blocked = 0 AND status_code = 200",
  [userId, rlEndpoint],
)) as unknown as Array<{ n: number | string }>;
assert(
  Number(usageRow[0].n) === RL_LIMIT,
  `blocked rows leaked into usage: ${usageRow[0].n}`,
);
console.log(
  `[mysql-e2e] MySQL agrees: ${unblockedCount?.n} non-blocked + ${blockedCount?.n} blocked rows (no over-count)`,
);

// ── 8) Verify PERSISTENCE directly in MySQL ────────────────────────────
const [rows] = (await check2.query(
  "SELECT endpoint, method, status_code, latency_ms, user_id FROM api_requests WHERE endpoint IN ('/api/v1/e2e-checkout','/api/v1/e2e-orders') ORDER BY id DESC LIMIT 5",
)) as unknown as Array<{
  endpoint: string;
  method: string;
  status_code: number;
  latency_ms: number;
  user_id: number;
}>;
console.log("[mysql-e2e] rows persisted in MySQL:", JSON.stringify(rows, null, 1));
assert(rows.length >= 4, `expected >=4 persisted webhook rows, got ${rows.length}`);
for (const r of rows) {
  assert(r.user_id === userId, `webhook row userId=${r.user_id} != ${userId}`);
}
const [keyRow] = (await check2.query(
  "SELECT name, last_used_at FROM api_keys WHERE user_id = ?",
  [userId],
)) as unknown as Array<{ name: string; last_used_at: Date | string | null }>;
console.log("[mysql-e2e] api_keys row:", JSON.stringify(keyRow));
assert(keyRow[0]?.name === "e2e-key", "api key row missing/name mismatch");
assert(keyRow[0]?.last_used_at != null, "lastUsedAt not updated after ingest");

const [overviewRow] = (await check2.query(
  "SELECT COUNT(*) AS total FROM api_requests WHERE user_id = ?",
  [userId],
)) as unknown as Array<{ total: number | string }>;
const totalRows = Number(overviewRow[0].total);
console.log(`[mysql-e2e] total rows for user ${userId} in MySQL: ${totalRows}`);
assert(totalRows >= 1504, `expected 1504 rows in MySQL, got ${totalRows}`);

// The dashboard queries must now reflect the webhook data too.
const overview1 = await authed.monitoring.overview.query({ timeRange: "7d" });
console.log(
  `[mysql-e2e] overview after webhook: total=${overview1.totalRequests} p95=${overview1.p95LatencyMs}`,
);
assert(overview1.totalRequests >= 1504, "overview did not reflect the webhook-ingested rows");

await check2.end();
if (server) {
  await server.stop().catch(() => {});
}
console.log("\n[mysql-e2e] ALL CHECKS PASSED — real MySQL end-to-end verified ✅");
process.exit(0);
