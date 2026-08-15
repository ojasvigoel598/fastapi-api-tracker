/**
 * Database Seed Script
 *
 * Generates 1500+ realistic API request logs and sample alerts.
 * Run with: npm run db:seed (optionally set SEED_USER_ID=<id>)
 */

import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { apiRequests, alerts, users } from "./schema";

const ENDPOINTS = [
  { path: "/api/v1/users", methods: ["GET", "POST", "PUT", "DELETE"] },
  { path: "/api/v1/users/:id/profile", methods: ["GET", "PUT"] },
  { path: "/api/v1/auth/login", methods: ["POST"] },
  { path: "/api/v1/auth/logout", methods: ["POST"] },
  { path: "/api/v1/auth/refresh", methods: ["POST"] },
  { path: "/api/v1/products", methods: ["GET", "POST", "PUT", "DELETE"] },
  { path: "/api/v1/products/:id", methods: ["GET", "PUT", "DELETE"] },
  { path: "/api/v1/products/search", methods: ["GET"] },
  { path: "/api/v1/orders", methods: ["GET", "POST"] },
  { path: "/api/v1/orders/:id", methods: ["GET", "PUT", "DELETE"] },
  { path: "/api/v1/orders/:id/status", methods: ["GET", "PATCH"] },
  { path: "/api/v1/payments/process", methods: ["POST"] },
  { path: "/api/v1/payments/:id/refund", methods: ["POST"] },
  { path: "/api/v1/notifications", methods: ["GET", "POST"] },
  { path: "/api/v1/notifications/:id/read", methods: ["PATCH"] },
  { path: "/api/v1/uploads", methods: ["POST"] },
  { path: "/api/v1/uploads/:id", methods: ["GET", "DELETE"] },
  { path: "/api/v1/reports/sales", methods: ["GET"] },
  { path: "/api/v1/reports/traffic", methods: ["GET"] },
  { path: "/api/v1/webhooks", methods: ["POST", "GET", "DELETE"] },
  { path: "/api/v1/health", methods: ["GET"] },
  { path: "/api/v1/metrics", methods: ["GET"] },
  { path: "/api/v1/settings", methods: ["GET", "PUT"] },
  { path: "/api/v1/search", methods: ["GET"] },
  { path: "/api/v1/export", methods: ["POST"] },
];

const STATUS_CODES = [200, 200, 200, 200, 201, 201, 204, 301, 400, 401, 403, 404, 422, 500, 502, 503];

const ERROR_MESSAGES: Record<number, string> = {
  400: "Bad Request: Invalid parameters",
  401: "Unauthorized: Authentication required",
  403: "Forbidden: Insufficient permissions",
  404: "Not Found: Resource does not exist",
  422: "Unprocessable Entity: Validation failed",
  429: "Too Many Requests: Rate limit exceeded",
  500: "Internal Server Error",
  502: "Bad Gateway: Upstream service error",
  503: "Service Unavailable: Temporary outage",
  504: "Gateway Timeout: Request timed out",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "PostmanRuntime/7.35.0",
  "curl/8.4.0",
  "python-requests/2.31.0",
  "Go-http-client/2.0",
];

const SOURCE_IPS = ["192.168.1.100", "192.168.1.101", "10.0.0.45", "172.16.0.12", "203.0.113.45"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  const db = getDb();
  const requestedUserId = Number(process.env.SEED_USER_ID ?? 0);
  const userRows = requestedUserId > 0
    ? await db.select({ id: users.id }).from(users).where(eq(users.id, requestedUserId)).limit(1)
    : await db.select({ id: users.id }).from(users).limit(1);
  const seedUserId = userRows[0]?.id;
  if (!seedUserId) {
    throw new Error(
      "No application user exists. Create an account first or set SEED_USER_ID to an existing user id.",
    );
  }

  console.log(`Starting seed for user ${seedUserId}...`);

  // Clear existing data
  await db.delete(apiRequests);
  await db.delete(alerts);
  console.log("Cleared existing data");

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const count = 1500;
  const batchSize = 200;

  for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    const logs: typeof apiRequests.$inferInsert[] = [];

    for (let i = 0; i < batchSize && batch * batchSize + i < count; i++) {
      const ep = ENDPOINTS[randomInt(0, ENDPOINTS.length - 1)];
      const method = ep.methods[randomInt(0, ep.methods.length - 1)];
      const path = ep.path.replace(":id", String(randomInt(1, 9999)));
      const statusCode = STATUS_CODES[randomInt(0, STATUS_CODES.length - 1)];

      let baseLatency = 20;
      if (path.includes("upload")) baseLatency = 150;
      else if (path.includes("search")) baseLatency = 80;
      else if (path.includes("export")) baseLatency = 200;
      else if (path.includes("payment")) baseLatency = 100;
      else if (path.includes("reports")) baseLatency = 120;
      else if (path.includes("auth")) baseLatency = 40;
      else if (path.includes("webhook")) baseLatency = 60;

      const jitter = Math.random() * baseLatency * 0.5;
      const spike = Math.random() > 0.9 ? randomInt(200, 2000) : 0;
      const latency = Math.round(baseLatency + jitter + spike);

      const timeWeight = Math.pow(Math.random(), 0.7);
      const ts = new Date(Math.round(sevenDaysAgo + timeWeight * (now - sevenDaysAgo)));

      logs.push({
        userId: seedUserId,
        endpoint: path,
        method,
        statusCode,
        latencyMs: latency,
        errorMessage: statusCode >= 400 ? ERROR_MESSAGES[statusCode] || "Error" : null,
        responseSize: statusCode < 400 ? randomInt(100, 50000) : randomInt(50, 500),
        sourceIp: SOURCE_IPS[randomInt(0, SOURCE_IPS.length - 1)],
        userAgent: USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)],
        requestHeaders: { "Content-Type": "application/json" },
        createdAt: ts,
      });
    }

    await db.insert(apiRequests).values(logs);
    console.log(`Inserted batch ${batch + 1}/${Math.ceil(count / batchSize)} (${(batch + 1) * batchSize} records)`);
  }

  // Insert sample alerts
  await db.insert(alerts).values([
    {
      userId: seedUserId,
      type: "latency_spike",
      severity: "warning",
      endpoint: "/api/v1/search",
      message: "Endpoint /api/v1/search latency increased to 850ms (threshold: 500ms)",
      details: { currentLatency: 850, threshold: 500, previousAvg: 120 },
      acknowledged: 0,
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    },
    {
      userId: seedUserId,
      type: "failure_rate_spike",
      severity: "critical",
      endpoint: "/api/v1/payments/process",
      message: "Payment processing failure rate reached 35% in the last hour",
      details: { failureRate: 35, threshold: 10, totalRequests: 120, failedRequests: 42 },
      acknowledged: 0,
      createdAt: new Date(now - 45 * 60 * 1000),
    },
    {
      userId: seedUserId,
      type: "error_rate_threshold",
      severity: "warning",
      endpoint: "/api/v1/uploads",
      message: "Upload endpoint returning 413 Payload Too Large errors",
      details: { statusCode: 413, count: 25, timeWindow: "1h" },
      acknowledged: 0,
      createdAt: new Date(now - 3 * 60 * 60 * 1000),
    },
    {
      userId: seedUserId,
      type: "endpoint_down",
      severity: "critical",
      endpoint: "/api/v1/webhooks",
      message: "Webhook endpoint returning 503 Service Unavailable",
      details: { statusCode: 503, consecutiveFailures: 15, downtime: "12 minutes" },
      acknowledged: 1,
      acknowledgedAt: new Date(now - 30 * 60 * 1000),
      createdAt: new Date(now - 4 * 60 * 60 * 1000),
    },
    {
      userId: seedUserId,
      type: "latency_spike",
      severity: "info",
      endpoint: "/api/v1/reports/sales",
      message: "Report generation latency normalized to 180ms",
      details: { currentLatency: 180, previousAvg: 450, trend: "improving" },
      acknowledged: 1,
      acknowledgedAt: new Date(now - 60 * 60 * 1000),
      createdAt: new Date(now - 6 * 60 * 60 * 1000),
    },
  ]);

  console.log("Seed complete! Created 1500 request logs and 5 alerts.");
}

seed().catch(console.error);
