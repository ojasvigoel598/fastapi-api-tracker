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
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
