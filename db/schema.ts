import { sql } from "drizzle-orm";
import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  bigint,
  float,
  index,
  json,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
    id: serial("id").primaryKey(),
    // Email is the primary login identity for application authentication.
    email: varchar("email", { length: 320 }).notNull().unique(),
    // Credentials for local email/password auth (scrypt). Null for users that
    // only sign in through Supabase OAuth/password.
    passwordHash: varchar("password_hash", { length: 255 }),
    passwordSalt: varchar("password_salt", { length: 255 }),
    // Supabase Auth user id (the JWT `sub` claim).
    supabaseId: varchar("supabase_id", { length: 64 }).unique(),
    // Clerk user id (the verified session token `sub` claim).
    clerkId: varchar("clerk_id", { length: 64 }).unique(),
    // Legacy Kimi OAuth union id — no longer used for login, kept for optional
    // Kimi linking.
    unionId: varchar("unionId", { length: 255 }).unique(),
    // Session revocation version: every issued session token carries the
    // user's current value, and logout / password change bumps it, so all
    // previously issued tokens (including stolen ones) stop validating
    // immediately instead of living out their 7-day lifetime.
    tokenVersion: int("token_version").notNull().default(0),
    name: varchar("name", { length: 255 }),
    avatar: text("avatar"),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
  }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Webhook API Keys - long-lived credentials for real-time telemetry ingest.
 *
 * An external API gateway can POST request telemetry to
 * `POST /api/webhook/ingest` with `Authorization: Bearer <key>` instead of
 * needing a browser session. Only a SHA-256 hash of the key is stored; the
 * plaintext is shown once at creation and can never be recovered.
 */
export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    name: varchar("name", { length: 120 }).notNull(),
    // SHA-256 hex digest of the full key (key_hash is what the webhook
    // handler looks up; the plaintext key is never persisted).
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    // Last 4 characters of the plaintext key, so the UI can identify a key
    // without ever revealing it.
    keyHint: varchar("key_hint", { length: 4 }).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("api_keys_user_idx").on(table.userId),
    keyHashIdx: uniqueIndex("api_keys_hash_idx").on(table.keyHash),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

/**
 * API Requests Log - stores every API request for monitoring.
 * Each row is owned by a single user (multi-tenant isolation).
 */
export const apiRequests = mysqlTable(
  "api_requests",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    endpoint: varchar("endpoint", { length: 500 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    statusCode: int("status_code").notNull(),
    latencyMs: int("latency_ms").notNull(),
    errorMessage: text("error_message"),
    requestHeaders: json("request_headers").$type<Record<string, string>>(),
    responseSize: int("response_size"),
    sourceIp: varchar("source_ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    // Monetary cost attributed to this request (for spending limits).
    cost: float("cost").notNull().default(0),
    // 1 when the request was rejected by rate limiting (not real usage).
    blocked: int("blocked").notNull().default(0),
    // fsp 6 (microseconds) so freshly-inserted rows are never rounded into the
    // "future". With fsp 0, MySQL rounds e.g. 21:57:25.9 to 21:57:26, and the
    // app's own `created_at <= now` queries then treat the brand-new row as one
    // second in the future — it becomes invisible to overview/timeSeries/rate
    // limits until the clock ticks past the rounded value.
    createdAt: timestamp("created_at", { fsp: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("api_requests_user_idx").on(table.userId),
    endpointIdx: index("endpoint_idx").on(table.endpoint),
    methodIdx: index("method_idx").on(table.method),
    statusCodeIdx: index("status_code_idx").on(table.statusCode),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  }),
);

export type ApiRequest = typeof apiRequests.$inferSelect;
export type InsertApiRequest = typeof apiRequests.$inferInsert;

/**
 * Endpoints Registry - tracks aggregated stats per endpoint per user.
 */
export const endpoints = mysqlTable(
  "endpoints",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    path: varchar("path", { length: 500 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    totalRequests: bigint("total_requests", {
      mode: "number",
      unsigned: true,
    })
      .notNull()
      .default(0),
    successfulRequests: bigint("successful_requests", {
      mode: "number",
      unsigned: true,
    })
      .notNull()
      .default(0),
    failedRequests: bigint("failed_requests", {
      mode: "number",
      unsigned: true,
    })
      .notNull()
      .default(0),
    avgLatencyMs: float("avg_latency_ms").notNull().default(0),
    maxLatencyMs: int("max_latency_ms").notNull().default(0),
    minLatencyMs: int("min_latency_ms").notNull().default(0),
    p50LatencyMs: float("p50_latency_ms").notNull().default(0),
    p95LatencyMs: float("p95_latency_ms").notNull().default(0),
    p99LatencyMs: float("p99_latency_ms").notNull().default(0),
    lastRequestedAt: timestamp("last_requested_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("endpoints_user_idx").on(table.userId),
    pathIdx: index("path_idx").on(table.path),
    // One registry entry per (user, endpoint, method).
    uniqueEndpoint: uniqueIndex("endpoints_user_path_method_idx").on(
      table.userId,
      table.path,
      table.method,
    ),
  }),
);

export type Endpoint = typeof endpoints.$inferSelect;
export type InsertEndpoint = typeof endpoints.$inferInsert;

/**
 * Alerts - stores triggered alerts and their configurations (per user).
 */
export const alerts = mysqlTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    type: mysqlEnum("type", [
      "failure_rate_spike",
      "latency_spike",
      "error_rate_threshold",
      "endpoint_down",
    ]).notNull(),
    severity: mysqlEnum("severity", ["critical", "warning", "info"])
      .notNull()
      .default("warning"),
    endpoint: varchar("endpoint", { length: 500 }),
    message: text("message").notNull(),
    details: json("details").$type<Record<string, unknown>>(),
    acknowledged: int("acknowledged").notNull().default(0),
    acknowledgedBy: bigint("acknowledged_by", {
      mode: "number",
      unsigned: true,
    }),
    acknowledgedAt: timestamp("acknowledged_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("alerts_user_idx").on(table.userId),
    typeIdx: index("type_idx").on(table.type),
    severityIdx: index("severity_idx").on(table.severity),
    createdAtIdx: index("alerts_created_at_idx").on(table.createdAt),
  }),
);

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

/**
 * Alert Rules - configurable rules for auto-generating alerts (per user).
 */
export const alertRules = mysqlTable("alert_rules", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull().default(0),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", [
    "failure_rate_spike",
    "latency_spike",
    "error_rate_threshold",
    "endpoint_down",
  ]).notNull(),
  endpoint: varchar("endpoint", { length: 500 }),
  threshold: float("threshold").notNull(),
  timeWindowMinutes: int("time_window_minutes").notNull().default(5),
  enabled: int("enabled").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AlertRule = typeof alertRules.$inferSelect;
export type InsertAlertRule = typeof alertRules.$inferInsert;

/**
 * Usage Limits - per-endpoint request/cost limits with threshold and
 * rate-limiting configuration (per user).
 *
 * Usage is derived from the `api_requests` table (non-blocked rows), so the
 * counts are the source of truth and never drift from a stale counter.
 */
export const usageLimits = mysqlTable(
  "usage_limits",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    endpoint: varchar("endpoint", { length: 500 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    // null = unlimited for that period.
    dailyLimit: int("daily_limit"),
    monthlyLimit: int("monthly_limit"),
    // Monthly monetary spending limit.
    costLimit: float("cost_limit"),
    // Percentage thresholds (0-100).
    warningThreshold: float("warning_threshold").notNull().default(80),
    criticalThreshold: float("critical_threshold").notNull().default(95),
    emailAlerts: int("email_alerts").notNull().default(0),
    rateLimiting: int("rate_limiting").notNull().default(0),
    // Period keys already evaluated, used to detect a usage reset.
    lastDailyPeriodKey: varchar("last_daily_period_key", { length: 20 }),
    lastMonthlyPeriodKey: varchar("last_monthly_period_key", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("usage_limits_user_idx").on(table.userId),
    endpointIdx: index("usage_limits_endpoint_idx").on(table.endpoint),
    // One limit config per (user, endpoint, method).
    uniqueLimit: uniqueIndex("usage_limits_user_endpoint_method_idx").on(
      table.userId,
      table.endpoint,
      table.method,
    ),
  }),
);

export type UsageLimit = typeof usageLimits.$inferSelect;
export type InsertUsageLimit = typeof usageLimits.$inferInsert;

/**
 * Usage Alerts - the notification/alert state for limit thresholds.
 *
 * The unique index dedupes alerts so a threshold fires at most once per
 * (limit, period, severity, periodKey). When the period rolls over, the
 * periodKey changes and the same threshold can fire again.
 */
export const usageAlerts = mysqlTable(
  "usage_alerts",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    limitId: int("limit_id").notNull(),
    endpoint: varchar("endpoint", { length: 500 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    period: mysqlEnum("period", ["daily", "monthly"]).notNull(),
    severity: mysqlEnum("severity", [
      "warning",
      "critical",
      "limit",
      "reset",
    ]).notNull(),
    periodKey: varchar("period_key", { length: 20 }).notNull(),
    message: text("message").notNull(),
    details: json("details").$type<Record<string, unknown>>(),
    // 1 when an email notification was successfully sent.
    emailed: int("emailed").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("usage_alerts_user_idx").on(table.userId),
    limitIdx: index("usage_alerts_limit_idx").on(table.limitId),
    createdAtIdx: index("usage_alerts_created_at_idx").on(table.createdAt),
    dedupeIdx: uniqueIndex("usage_alerts_dedupe_idx").on(
      table.limitId,
      table.period,
      table.severity,
      table.periodKey,
    ),
  }),
);

export type UsageAlert = typeof usageAlerts.$inferSelect;
export type InsertUsageAlert = typeof usageAlerts.$inferInsert;

/**
 * Webhook Deliveries - raw telemetry batches received via the webhook,
 * retained for replay.
 *
 * Stores the exact validated event payloads a gateway submitted to
 * `POST /api/webhook/ingest`, so a signed-in user can re-fire a delivery
 * (e.g. after fixing a consumer bug) without re-sending it from the gateway.
 * Capped at the most recent `MAX_DELIVERIES_PER_USER` per user. `outcome` is
 * `received` when every event was recorded, `blocked` when a rate limit
 * stopped the batch part-way.
 */
export const webhookDeliveries = mysqlTable(
  "webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull().default(0),
    // Owning key (nullable for safety; key rows can be revoked).
    keyId: int("key_id"),
    // Snapshot of the key name at delivery time (survives key deletion).
    keyName: varchar("key_name", { length: 120 }),
    outcome: mysqlEnum("outcome", ["received", "blocked"]).notNull(),
    eventCount: int("event_count").notNull(),
    events: json("events").$type<Record<string, unknown>[]>().notNull(),
    // now(6) keeps microsecond precision even as a DEFAULT (plain now()
    // evaluates with fsp 0); the app also always passes receivedAt explicitly.
    receivedAt: timestamp("received_at", { fsp: 6 })
      .notNull()
      .default(sql`(now(6))`),
  },
  (table) => ({
    userIdIdx: index("webhook_deliveries_user_idx").on(table.userId),
    receivedAtIdx: index("webhook_deliveries_received_at_idx").on(
      table.receivedAt,
    ),
  }),
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertWebhookDelivery = typeof webhookDeliveries.$inferInsert;
