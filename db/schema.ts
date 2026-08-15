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
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * API Requests Log - stores every API request for monitoring
 * Includes indexing on commonly queried fields for performance
 */
export const apiRequests = mysqlTable(
  "api_requests",
  {
    id: serial("id").primaryKey(),
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
    endpointIdx: index("endpoint_idx").on(table.endpoint),
    methodIdx: index("method_idx").on(table.method),
    statusCodeIdx: index("status_code_idx").on(table.statusCode),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

export type ApiRequest = typeof apiRequests.$inferSelect;
export type InsertApiRequest = typeof apiRequests.$inferInsert;

/**
 * Endpoints Registry - tracks aggregated stats per endpoint
 * Updated periodically to maintain fast query performance
 */
export const endpoints = mysqlTable(
  "endpoints",
  {
    id: serial("id").primaryKey(),
    path: varchar("path", { length: 500 }).notNull().unique(),
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
    pathIdx: index("path_idx").on(table.path),
  })
);

export type Endpoint = typeof endpoints.$inferSelect;
export type InsertEndpoint = typeof endpoints.$inferInsert;

/**
 * Alerts - stores triggered alerts and their configurations
 */
export const alerts = mysqlTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
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
    typeIdx: index("type_idx").on(table.type),
    severityIdx: index("severity_idx").on(table.severity),
    createdAtIdx: index("alerts_created_at_idx").on(table.createdAt),
  })
);

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

/**
 * Alert Rules - configurable rules for auto-generating alerts
 */
export const alertRules = mysqlTable("alert_rules", {
  id: serial("id").primaryKey(),
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
