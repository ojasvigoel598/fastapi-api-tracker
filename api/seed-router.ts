/**
 * Seed Router - Generate realistic mock API monitoring data
 *
 * This router creates sample data for demo purposes:
 * - 1000+ API request logs with realistic patterns
 * - Various endpoints with different performance characteristics
 * - Mix of success/failure status codes
 * - Latency variations to simulate real-world conditions
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { apiRequests, alerts } from "@db/schema";
import { env } from "./lib/env";
import * as demoStore from "./demo/store";

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

const STATUS_CODES = {
  success: [200, 201, 204],
  redirect: [301, 302, 304],
  clientError: [400, 401, 403, 404, 422, 429],
  serverError: [500, 502, 503, 504],
};

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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.0",
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.0",
  "PostmanRuntime/7.35.0",
  "curl/8.4.0",
  "python-requests/2.31.0",
  "Go-http-client/2.0",
  "Node.js/20.9.0",
  "okhttp/4.12.0",
  "API-Client/1.0.0",
];

const SOURCE_IPS = [
  "192.168.1.100",
  "192.168.1.101",
  "192.168.1.102",
  "10.0.0.45",
  "10.0.0.46",
  "172.16.0.12",
  "172.16.0.13",
  "203.0.113.45",
  "203.0.113.78",
  "198.51.100.22",
  "::1",
  "fe80::1",
  "192.168.2.50",
  "10.10.10.10",
];

function weightedRandom<T>(items: T[], weights: number[]): T {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    random -= weights[i];
    if (random <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateLatency(endpoint: string, statusCode: number): number {
  // Base latency varies by endpoint type
  let baseLatency = 20;

  if (endpoint.includes("upload")) baseLatency = 150;
  else if (endpoint.includes("search")) baseLatency = 80;
  else if (endpoint.includes("export")) baseLatency = 200;
  else if (endpoint.includes("payment")) baseLatency = 100;
  else if (endpoint.includes("reports")) baseLatency = 120;
  else if (endpoint.includes("auth")) baseLatency = 40;
  else if (endpoint.includes("webhook")) baseLatency = 60;

  // Error responses tend to be faster (fail early) or much slower (timeouts)
  if (statusCode >= 500) {
    baseLatency *= Math.random() > 0.5 ? 0.5 : 3;
  } else if (statusCode >= 400) {
    baseLatency *= 0.6;
  }

  // Add realistic jitter
  const jitter = Math.random() * baseLatency * 0.5;
  const spikeChance = Math.random();
  const spike = spikeChance > 0.95 ? randomInt(500, 2000) : spikeChance > 0.9 ? randomInt(200, 500) : 0;

  return Math.round(baseLatency + jitter + spike);
}

function generateStatusCode(endpoint: string): number {
  const weights =
    endpoint === "/api/v1/health"
      ? [98, 1, 0, 1] // health check: almost always 200
      : endpoint.includes("auth/login")
        ? [90, 0, 8, 2] // login: mostly success, some auth failures
        : endpoint.includes("upload")
          ? [85, 0, 12, 3] // uploads: more client errors
          : endpoint.includes("payment")
            ? [88, 0, 8, 4] // payments: some failures
            : endpoint.includes("webhook")
              ? [80, 0, 15, 5] // webhooks: more errors
              : [92, 3, 4, 1]; // default

  const category = weightedRandom(
    ["success", "redirect", "clientError", "serverError"],
    weights
  );

  const codes =
    STATUS_CODES[category as keyof typeof STATUS_CODES];
  return codes[randomInt(0, codes.length - 1)];
}

export const seedRouter = createRouter({
  generate: authedQuery
    .input(
      z
        .object({
          count: z.number().min(1).max(5000).optional().default(1200),
        })
        .optional()
    )
    .mutation(async ({ input, ctx }) => {
      if (env.isDemoMode) {
        demoStore.reseed(ctx.user.id);
        const now = Date.now();
        return {
          message: "Regenerated demo data",
          requestCount: 1500,
          alertCount: 5,
          timeRange: {
            from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date(now).toISOString(),
          },
        };
      }
      const db = getDb();
      const count = input?.count ?? 1200;

      // Generate request logs spread over the last 7 days
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      const logs: {
        endpoint: string;
        method: string;
        statusCode: number;
        latencyMs: number;
        errorMessage: string | null;
        responseSize: number | null;
        sourceIp: string | null;
        userAgent: string | null;
        requestHeaders: Record<string, string>;
        createdAt: Date;
        userId: number;
      }[] = [];

      for (let i = 0; i < count; i++) {
        const endpointDef = ENDPOINTS[randomInt(0, ENDPOINTS.length - 1)];
        const method =
          endpointDef.methods[randomInt(0, endpointDef.methods.length - 1)];

        // Replace :id with realistic IDs
        let path = endpointDef.path;
        if (path.includes(":id")) {
          path = path.replace(":id", String(randomInt(1, 9999)));
        }

        const statusCode = generateStatusCode(endpointDef.path);
        const latencyMs = generateLatency(endpointDef.path, statusCode);
        const errorMessage =
          statusCode >= 400 ? ERROR_MESSAGES[statusCode] ?? "Unknown error" : null;
        const responseSize =
          statusCode < 400 ? randomInt(100, 50000) : randomInt(50, 500);

        // Time distribution: more recent = more requests
        const timeWeight = Math.pow(Math.random(), 0.7); // bias toward recent
        const timestamp = new Date(
          Math.round(sevenDaysAgo + timeWeight * (sevenDaysAgo - now) * -1)
        );

        logs.push({
          endpoint: path,
          method,
          statusCode,
          latencyMs,
          errorMessage,
          responseSize,
          sourceIp: SOURCE_IPS[randomInt(0, SOURCE_IPS.length - 1)],
          userAgent: USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)],
          requestHeaders: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Request-ID": `req-${Math.random().toString(36).substring(2, 10)}`,
          },
          createdAt: timestamp,
          userId: ctx.user.id,
        });
      }

      // Insert in batches of 100
      const batchSize = 100;
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        await db.insert(apiRequests).values(batch);
      }

      // Generate some sample alerts
      const sampleAlerts = [
        {
          type: "latency_spike" as const,
          severity: "warning" as const,
          endpoint: "/api/v1/search",
          message: "Endpoint /api/v1/search latency increased to 850ms (threshold: 500ms)",
          details: { currentLatency: 850, threshold: 500, previousAvg: 120 },
          acknowledged: 0,
          createdAt: new Date(now - 2 * 60 * 60 * 1000),
        },
        {
          type: "failure_rate_spike" as const,
          severity: "critical" as const,
          endpoint: "/api/v1/payments/process",
          message: "Payment processing failure rate reached 35% in the last hour",
          details: { failureRate: 35, threshold: 10, totalRequests: 120, failedRequests: 42 },
          acknowledged: 0,
          createdAt: new Date(now - 45 * 60 * 1000),
        },
        {
          type: "error_rate_threshold" as const,
          severity: "warning" as const,
          endpoint: "/api/v1/uploads",
          message: "Upload endpoint returning 413 Payload Too Large errors",
          details: { statusCode: 413, count: 25, timeWindow: "1h" },
          acknowledged: 0,
          createdAt: new Date(now - 3 * 60 * 60 * 1000),
        },
        {
          type: "endpoint_down" as const,
          severity: "critical" as const,
          endpoint: "/api/v1/webhooks",
          message: "Webhook endpoint returning 503 Service Unavailable",
          details: { statusCode: 503, consecutiveFailures: 15, downtime: "12 minutes" },
          acknowledged: 1,
          acknowledgedBy: null,
          acknowledgedAt: new Date(now - 30 * 60 * 1000),
          createdAt: new Date(now - 4 * 60 * 60 * 1000),
        },
        {
          type: "latency_spike" as const,
          severity: "info" as const,
          endpoint: "/api/v1/reports/sales",
          message: "Report generation latency normalized to 180ms",
          details: { currentLatency: 180, previousAvg: 450, trend: "improving" },
          acknowledged: 1,
          acknowledgedBy: null,
          acknowledgedAt: new Date(now - 60 * 60 * 1000),
          createdAt: new Date(now - 6 * 60 * 60 * 1000),
        },
      ];

      await db.insert(alerts).values(
        sampleAlerts.map((a) => ({ ...a, userId: ctx.user.id })),
      );

      return {
        message: `Generated ${count} request logs and ${sampleAlerts.length} alerts`,
        requestCount: count,
        alertCount: sampleAlerts.length,
        timeRange: {
          from: new Date(sevenDaysAgo).toISOString(),
          to: new Date(now).toISOString(),
        },
      };
    }),

  clear: authedQuery.mutation(async ({ ctx }) => {
    if (env.isDemoMode) {
      demoStore.clear(ctx.user.id);
      return { message: "Your monitoring data cleared" };
    }
    const db = getDb();
    await db.delete(apiRequests).where(eq(apiRequests.userId, ctx.user.id));
    await db.delete(alerts).where(eq(alerts.userId, ctx.user.id));
    return { message: "Your monitoring data cleared" };
  }),
});
