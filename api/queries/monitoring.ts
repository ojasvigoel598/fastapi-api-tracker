/**
 * Monitoring Query Functions
 *
 * Provides data access layer for API monitoring:
 * - Request logging and retrieval with filtering
 * - Aggregated analytics and metrics
 * - Endpoint performance tracking
 * - Alert management
 *
 * Every function is scoped to a single `userId` so rows are never shared
 * across accounts.
 */

import { getDb } from "./connection";
import { env } from "../lib/env";
import * as demoStore from "../demo/store";
import {
  apiRequests,
  endpoints,
  alerts,
  type ApiRequest,
  type InsertApiRequest,
  type InsertAlert,
} from "@db/schema";
import {
  eq,
  desc,
  asc,
  and,
  gte,
  lte,
  sql,
  count,
  avg,
  like,
  or,
  type SQLWrapper,
} from "drizzle-orm";
import { getDateBounds, type TimeRange } from "./time-range";

// ─── Types ────────────────────────────────────────────────────────────

export type { TimeRange } from "./time-range";

export interface RequestFilters {
  endpoint?: string;
  method?: string;
  statusCode?: number;
  // Inclusive status-code bounds (e.g. minStatusCode: 400 → failures only).
  minStatusCode?: number;
  maxStatusCode?: number;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  timeRange?: TimeRange;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// ─── Helpers ──────────────────────────────────────────────────────────


function buildWhereClause(filters: RequestFilters, userId: number) {
  const conditions: (SQLWrapper | undefined)[] = [eq(apiRequests.userId, userId)];

  if (filters.endpoint) {
    conditions.push(eq(apiRequests.endpoint, filters.endpoint));
  }

  if (filters.method) {
    conditions.push(eq(apiRequests.method, filters.method));
  }

  if (filters.statusCode) {
    conditions.push(eq(apiRequests.statusCode, filters.statusCode));
  }

  if (filters.minStatusCode !== undefined) {
    conditions.push(gte(apiRequests.statusCode, filters.minStatusCode));
  }

  if (filters.maxStatusCode !== undefined) {
    conditions.push(lte(apiRequests.statusCode, filters.maxStatusCode));
  }

  if (filters.startDate) {
    conditions.push(gte(apiRequests.createdAt, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(apiRequests.createdAt, filters.endDate));
  }

  if (filters.timeRange) {
    const bounds = getDateBounds(filters.timeRange, filters.startDate, filters.endDate);
    conditions.push(gte(apiRequests.createdAt, bounds.since));
    conditions.push(lte(apiRequests.createdAt, bounds.until));
  }

  if (filters.search) {
    conditions.push(
      or(
        like(apiRequests.endpoint, `%${filters.search}%`),
        like(apiRequests.errorMessage || "", `%${filters.search}%`),
      ),
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ─── Request Log Queries ──────────────────────────────────────────────

/**
 * Create a new API request log entry
 */
export async function createRequestLog(
  data: InsertApiRequest,
): Promise<ApiRequest> {
  if (env.isDemoMode) return demoStore.createRequestLog(data);
  const db = getDb();
  const [result] = await db.insert(apiRequests).values(data).$returningId();
  const log = await db.query.apiRequests.findFirst({
    where: eq(apiRequests.id, result.id),
  });
  if (!log) throw new Error("Failed to create request log");
  return log;
}

/**
 * Get paginated request logs with optional filtering
 */
export async function getRequestLogs(
  filters: RequestFilters = {},
  pagination: PaginationParams = {},
  userId: number,
): Promise<{ items: ApiRequest[]; total: number }> {
  if (env.isDemoMode) return demoStore.requestLogs(filters, pagination, userId);
  const db = getDb();
  const { page = 1, pageSize = 50, sortBy = "createdAt", sortOrder = "desc" } = pagination;

  const where = buildWhereClause(filters, userId);

  const orderCol =
    sortBy === "createdAt"
      ? apiRequests.createdAt
      : sortBy === "latencyMs"
        ? apiRequests.latencyMs
        : sortBy === "statusCode"
          ? apiRequests.statusCode
          : apiRequests.createdAt;

  const orderFn = sortOrder === "asc" ? asc : desc;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(apiRequests)
      .where(where)
      .orderBy(orderFn(orderCol))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: count() })
      .from(apiRequests)
      .where(where),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Get a single request log by ID (must belong to the user)
 */
export async function getRequestLogById(
  id: number,
  userId: number,
): Promise<ApiRequest | undefined> {
  if (env.isDemoMode) return demoStore.requestLogById(id, userId);
  const db = getDb();
  return db.query.apiRequests.findFirst({
    where: and(eq(apiRequests.id, id), eq(apiRequests.userId, userId)),
  });
}

// ─── Overview / KPI Queries ───────────────────────────────────────────

export interface OverviewMetrics {
  totalRequests: number;
  failedRequests: number;
  failureRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  requestsChangePercent: number;
  failureRateChangePercent: number;
  latencyChangePercent: number;
  activeEndpoints: number;
}

/**
 * Get high-level KPI metrics for the dashboard overview
 */
export async function getOverviewMetrics(
  timeRange: TimeRange = "24h",
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<OverviewMetrics> {
  if (env.isDemoMode) return demoStore.overview(timeRange, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);
  const duration = until.getTime() - since.getTime();
  const previousSince = new Date(since.getTime() - duration);

  const [currentStats] = await db
    .select({
      total: count(),
      failed: sql<number>`SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END)`,
      avgLatency: avg(apiRequests.latencyMs),
    })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, since),
        lte(apiRequests.createdAt, until),
      ),
    );

  const [previousStats] = await db
    .select({
      total: count(),
      failed: sql<number>`SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END)`,
      avgLatency: avg(apiRequests.latencyMs),
    })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, previousSince),
        lte(apiRequests.createdAt, since),
      ),
    );

  const latencyRows = await db
    .select({ latency: apiRequests.latencyMs })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, since),
        lte(apiRequests.createdAt, until),
      ),
    )
    .orderBy(asc(apiRequests.latencyMs));

  const p95Index = Math.floor(latencyRows.length * 0.95);
  const p95Latency = latencyRows[p95Index]?.latency ?? 0;

  const endpointCount = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${apiRequests.endpoint})` })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, since),
        lte(apiRequests.createdAt, until),
      ),
    );

  const total = currentStats.total ?? 0;
  const failed = currentStats.failed ?? 0;
  const prevTotal = previousStats.total ?? 0;
  const prevFailed = previousStats.failed ?? 0;

  const failureRate = total > 0 ? (failed / total) * 100 : 0;
  const prevFailureRate = prevTotal > 0 ? (prevFailed / prevTotal) * 100 : 0;

  return {
    totalRequests: total,
    failedRequests: failed,
    failureRate: Math.round(failureRate * 100) / 100,
    avgLatencyMs: Math.round((Number(currentStats.avgLatency) || 0) * 100) / 100,
    p95LatencyMs: p95Latency,
    requestsChangePercent:
      prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100 * 100) / 100 : 0,
    failureRateChangePercent:
      Math.round((failureRate - prevFailureRate) * 100) / 100,
    latencyChangePercent: 0,
    activeEndpoints: endpointCount[0]?.count ?? 0,
  };
}

// ─── Time-Series Queries ──────────────────────────────────────────────

export interface TimeSeriesPoint {
  timestamp: Date;
  total: number;
  failed: number;
  avgLatency: number;
}

/**
 * Get request volume and failure data grouped by time buckets
 */
export async function getRequestTimeSeries(
  timeRange: TimeRange = "24h",
  groupBy: "minute" | "hour" | "day" = "hour",
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<TimeSeriesPoint[]> {
  if (env.isDemoMode) return demoStore.timeSeries(timeRange, groupBy, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);

  let formatStr: string;
  switch (groupBy) {
    case "minute":
      formatStr = "%Y-%m-%d %H:%i";
      break;
    case "hour":
      formatStr = "%Y-%m-%d %H:00";
      break;
    case "day":
      formatStr = "%Y-%m-%d";
      break;
  }

  const results = await db.execute(
    sql`
      SELECT
        DATE_FORMAT(${apiRequests.createdAt}, ${formatStr}) as time_bucket,
        COUNT(*) as total,
        SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END) as failed,
        AVG(${apiRequests.latencyMs}) as avg_latency
      FROM ${apiRequests}
      WHERE ${apiRequests.userId} = ${userId}
        AND ${apiRequests.createdAt} >= ${since}
        AND ${apiRequests.createdAt} <= ${until}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `,
  );

  const rows = (results[0] as unknown as Array<{ time_bucket: string | Date; total: number | string; failed: number | string; avg_latency: number | string }>) ?? [];

  return rows.map((r) => ({
    timestamp: r.time_bucket instanceof Date ? r.time_bucket : new Date(r.time_bucket),
    total: Number(r.total ?? 0),
    failed: Number(r.failed ?? 0),
    avgLatency: Math.round(Number(r.avg_latency ?? 0) * 100) / 100,
  }));
}

// ─── Endpoint Queries ─────────────────────────────────────────────────

/**
 * Get or create endpoint record
 */
export async function getOrCreateEndpoint(
  path: string,
  method: string,
  userId: number,
): Promise<number> {
  if (env.isDemoMode) return demoStore.getOrCreateEndpoint();
  const db = getDb();

  const existing = await db.query.endpoints.findFirst({
    where: and(eq(endpoints.path, path), eq(endpoints.userId, userId)),
  });

  if (existing) return existing.id;

  const [result] = await db
    .insert(endpoints)
    .values({ path, method, userId, minLatencyMs: 999999 })
    .$returningId();

  return result.id;
}

/**
 * Get all endpoints with aggregated stats (scoped to the user)
 */
export async function getEndpoints(
  timeRange: TimeRange = "24h",
  limit: number | undefined,
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<Endpoint[]> {
  if (env.isDemoMode) return demoStore.endpoints(timeRange, limit, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);

  const results = await db.execute(
    sql`
      SELECT
        ${apiRequests.endpoint} as path,
        ${apiRequests.method} as method,
        COUNT(*) as total_requests,
        SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END) as failed_requests,
        AVG(${apiRequests.latencyMs}) as avg_latency,
        MAX(${apiRequests.latencyMs}) as max_latency,
        MIN(${apiRequests.latencyMs}) as min_latency,
        MAX(${apiRequests.createdAt}) as last_requested
      FROM ${apiRequests}
      WHERE ${apiRequests.userId} = ${userId}
        AND ${apiRequests.createdAt} >= ${since}
        AND ${apiRequests.createdAt} <= ${until}
      GROUP BY ${apiRequests.endpoint}, ${apiRequests.method}
      ORDER BY total_requests DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `,
  );

  const rows = (results[0] as unknown as Array<{
    path: string;
    method: string;
    total_requests: number | string;
    failed_requests: number | string;
    avg_latency: number | string;
    max_latency: number | string;
    min_latency: number | string;
    last_requested: Date | string;
  }>) ?? [];

  return rows.map((r) => {
    const total = Number(r.total_requests ?? 0);
    const failed = Number(r.failed_requests ?? 0);
    return {
      id: 0,
      path: r.path,
      method: r.method,
      totalRequests: total,
      successfulRequests: total - failed,
      failedRequests: failed,
      avgLatencyMs: Math.round(Number(r.avg_latency ?? 0) * 100) / 100,
      maxLatencyMs: Number(r.max_latency ?? 0),
      minLatencyMs: Number(r.min_latency ?? 0),
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      lastRequestedAt: r.last_requested instanceof Date ? r.last_requested : new Date(r.last_requested),
      updatedAt: new Date(),
    };
  });
}

export type Endpoint = {
  id: number;
  path: string;
  method: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  lastRequestedAt: Date | null;
  updatedAt: Date;
};

// ─── Status Code Distribution ─────────────────────────────────────────

export interface StatusCodeDistribution {
  statusCode: number;
  count: number;
  percentage: number;
}

export async function getStatusCodeDistribution(
  timeRange: TimeRange = "24h",
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<StatusCodeDistribution[]> {
  if (env.isDemoMode) return demoStore.statusDistribution(timeRange, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);

  const results = await db
    .select({
      statusCode: apiRequests.statusCode,
      count: count(),
    })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, since),
        lte(apiRequests.createdAt, until),
      ),
    )
    .groupBy(apiRequests.statusCode)
    .orderBy(desc(count()));

  const total = results.reduce((sum, r) => sum + r.count, 0);

  return results.map((r) => ({
    statusCode: r.statusCode,
    count: r.count,
    percentage: total > 0 ? Math.round((r.count / total) * 100 * 100) / 100 : 0,
  }));
}

// ─── Latency Distribution ─────────────────────────────────────────────

export interface LatencyDistribution {
  bucket: string;
  count: number;
}

export async function getLatencyDistribution(
  timeRange: TimeRange = "24h",
  endpoint: string | undefined,
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<LatencyDistribution[]> {
  if (env.isDemoMode) return demoStore.latencyDistribution(timeRange, endpoint, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);

  const conditions = [
    eq(apiRequests.userId, userId),
    gte(apiRequests.createdAt, since),
    lte(apiRequests.createdAt, until),
  ];
  if (endpoint) {
    conditions.push(eq(apiRequests.endpoint, endpoint));
  }

  const results = await db.execute(
    sql`
      SELECT
        CASE
          WHEN ${apiRequests.latencyMs} < 50 THEN '< 50ms'
          WHEN ${apiRequests.latencyMs} < 100 THEN '50-100ms'
          WHEN ${apiRequests.latencyMs} < 200 THEN '100-200ms'
          WHEN ${apiRequests.latencyMs} < 500 THEN '200-500ms'
          WHEN ${apiRequests.latencyMs} < 1000 THEN '500ms-1s'
          ELSE '> 1s'
        END as bucket,
        COUNT(*) as count
      FROM ${apiRequests}
      WHERE ${and(...conditions)}
      GROUP BY bucket
      ORDER BY MIN(${apiRequests.latencyMs}) ASC
    `,
  );

  const rows = (results[0] as unknown as Array<{ bucket: string; count: number | string }>) ?? [];

  return rows.map((r) => ({
    bucket: r.bucket,
    count: Number(r.count ?? 0),
  }));
}

// ─── Alert Queries ────────────────────────────────────────────────────

/**
 * Get all alerts with optional filtering (scoped to the user)
 */
export async function getAlerts(
  filters: {
    severity?: string;
    acknowledged?: boolean;
    type?: string;
  } = {},
  userId: number,
): Promise<Alert[]> {
  if (env.isDemoMode) return demoStore.alertsList(filters, userId);
  const db = getDb();

  const conditions = [eq(alerts.userId, userId)];
  if (filters.severity) {
    conditions.push(eq(alerts.severity, filters.severity as "critical" | "warning" | "info"));
  }
  if (filters.type) {
    conditions.push(eq(alerts.type, filters.type as "failure_rate_spike" | "latency_spike" | "error_rate_threshold" | "endpoint_down"));
  }
  if (filters.acknowledged !== undefined) {
    conditions.push(
      filters.acknowledged
        ? eq(alerts.acknowledged, 1)
        : eq(alerts.acknowledged, 0),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(alerts)
    .where(where)
    .orderBy(desc(alerts.createdAt));
}

export type Alert = {
  id: number;
  type: "failure_rate_spike" | "latency_spike" | "error_rate_threshold" | "endpoint_down";
  severity: "critical" | "warning" | "info";
  endpoint: string | null;
  message: string;
  details: Record<string, unknown> | null;
  acknowledged: number;
  acknowledgedBy: number | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

/**
 * Create a new alert
 */
export async function createAlert(data: InsertAlert): Promise<Alert> {
  if (env.isDemoMode) return demoStore.createAlert(data);
  const db = getDb();
  const [result] = await db.insert(alerts).values(data).$returningId();
  const alert = await db.query.alerts.findFirst({
    where: eq(alerts.id, result.id),
  });
  if (!alert) throw new Error("Failed to create alert");
  return alert as Alert;
}

/**
 * Acknowledge an alert (must belong to the user)
 */
export async function acknowledgeAlert(
  alertId: number,
  userId: number,
): Promise<void> {
  if (env.isDemoMode) {
    demoStore.acknowledge(alertId, userId);
    return;
  }
  const db = getDb();
  await db
    .update(alerts)
    .set({
      acknowledged: 1,
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    })
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
}

// ─── Automated Insights ───────────────────────────────────────────────

export interface AutomatedInsight {
  type: "warning" | "critical" | "info";
  message: string;
  detail: string;
  endpoint?: string;
  metric?: string;
  changePercent?: number;
}

/**
 * Generate automated insights from monitoring data
 */
export async function generateInsights(
  timeRange: TimeRange = "1h",
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<AutomatedInsight[]> {
  if (env.isDemoMode) return demoStore.insights(timeRange, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);
  const insights: AutomatedInsight[] = [];

  const [currentFailures] = await db
    .select({
      total: count(),
      failed: sql<number>`SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END)`,
    })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, since),
        lte(apiRequests.createdAt, until),
      ),
    );

  const total = currentFailures.total ?? 0;
  const failed = currentFailures.failed ?? 0;
  const failureRate = total > 0 ? (failed / total) * 100 : 0;

  if (failureRate > 10) {
    insights.push({
      type: "critical",
      message: "High failure rate detected",
      detail: `${failureRate.toFixed(1)}% of requests failed in the last ${timeRange}`,
      metric: "failureRate",
      changePercent: failureRate,
    });
  } else if (failureRate > 5) {
    insights.push({
      type: "warning",
      message: "Elevated failure rate",
      detail: `${failureRate.toFixed(1)}% of requests are failing`,
      metric: "failureRate",
      changePercent: failureRate,
    });
  }

  // 2. Slowest endpoints
  const slowResults = await db.execute(
    sql`
      SELECT
        ${apiRequests.endpoint} as endpoint,
        AVG(${apiRequests.latencyMs}) as avg_latency,
        MAX(${apiRequests.latencyMs}) as max_latency,
        COUNT(*) as total
      FROM ${apiRequests}
      WHERE ${apiRequests.userId} = ${userId}
        AND ${apiRequests.createdAt} >= ${since}
        AND ${apiRequests.createdAt} <= ${until}
      GROUP BY ${apiRequests.endpoint}
      HAVING total >= 5
      ORDER BY avg_latency DESC
      LIMIT 3
    `,
  );

  const slowRows = (slowResults[0] as unknown as Array<{
    endpoint: string;
    avg_latency: number | string;
    max_latency: number | string;
    total: number | string;
  }>) ?? [];

  const slowest = slowRows.map((r) => ({
    endpoint: r.endpoint,
    avgLatency: Number(r.avg_latency ?? 0),
    maxLatency: Number(r.max_latency ?? 0),
    total: Number(r.total ?? 0),
  }));

  if (slowest.length > 0 && slowest[0].avgLatency > 500) {
    insights.push({
      type: slowest[0].avgLatency > 1000 ? "critical" : "warning",
      message: "Slow endpoint detected",
      detail: `${slowest[0].endpoint} averages ${slowest[0].avgLatency.toFixed(0)}ms response time`,
      endpoint: slowest[0].endpoint,
      metric: "avgLatency",
    });
  }

  // 3. Most failing endpoints
  const failResults = await db.execute(
    sql`
      SELECT
        ${apiRequests.endpoint} as endpoint,
        COUNT(*) as total,
        SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END) as failed,
        (SUM(CASE WHEN ${apiRequests.statusCode} >= 400 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as fail_rate
      FROM ${apiRequests}
      WHERE ${apiRequests.userId} = ${userId}
        AND ${apiRequests.createdAt} >= ${since}
        AND ${apiRequests.createdAt} <= ${until}
      GROUP BY ${apiRequests.endpoint}
      HAVING total >= 5
      ORDER BY fail_rate DESC
      LIMIT 3
    `,
  );

  const failRows = (failResults[0] as unknown as Array<{
    endpoint: string;
    total: number | string;
    failed: number | string;
    fail_rate: number | string;
  }>) ?? [];

  const failing = failRows.map((r) => ({
    endpoint: r.endpoint,
    total: Number(r.total ?? 0),
    failed: Number(r.failed ?? 0),
    failRate: Number(r.fail_rate ?? 0),
  }));

  if (failing.length > 0 && failing[0].failRate > 20) {
    insights.push({
      type: "critical",
      message: "Endpoint with high failure rate",
      detail: `${failing[0].endpoint} has ${failing[0].failRate.toFixed(1)}% failure rate (${failing[0].failed}/${failing[0].total} requests)`,
      endpoint: failing[0].endpoint,
      metric: "failureRate",
    });
  }

  // 4. Request volume spike
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const [recentVolume] = await db
    .select({ count: count() })
    .from(apiRequests)
    .where(and(eq(apiRequests.userId, userId), gte(apiRequests.createdAt, hourAgo)));

  const [previousVolume] = await db
    .select({ count: count() })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, twoHoursAgo),
        lte(apiRequests.createdAt, hourAgo),
      ),
    );

  const recentCount = recentVolume.count ?? 0;
  const prevCount = previousVolume.count ?? 0;

  if (prevCount > 0) {
    const changePercent = ((recentCount - prevCount) / prevCount) * 100;
    if (changePercent > 50) {
      insights.push({
        type: "info",
        message: "Request volume spike",
        detail: `Traffic increased by ${changePercent.toFixed(0)}% compared to previous hour (${recentCount} vs ${prevCount} requests)`,
        metric: "requestVolume",
        changePercent: Math.round(changePercent * 100) / 100,
      });
    } else if (changePercent < -50) {
      insights.push({
        type: "warning",
        message: "Request volume drop",
        detail: `Traffic decreased by ${Math.abs(changePercent).toFixed(0)}% compared to previous hour`,
        metric: "requestVolume",
        changePercent: Math.round(changePercent * 100) / 100,
      });
    }
  }

  return insights;
}

// ─── Export Data ──────────────────────────────────────────────────────

export async function exportRequests(
  filters: RequestFilters,
  format: "csv" | "json",
  userId: number,
): Promise<string> {
  if (env.isDemoMode) return demoStore.exportRequests(filters, format, userId);
  const { items } = await getRequestLogs(filters, { page: 1, pageSize: 10000 }, userId);

  if (format === "json") {
    return JSON.stringify(
      items.map((item) => ({
        id: item.id,
        timestamp: item.createdAt.toISOString(),
        endpoint: item.endpoint,
        method: item.method,
        statusCode: item.statusCode,
        latencyMs: item.latencyMs,
        errorMessage: item.errorMessage,
        responseSize: item.responseSize,
        sourceIp: item.sourceIp,
        userAgent: item.userAgent,
      })),
      null,
      2,
    );
  }

  const headers = [
    "ID",
    "Timestamp",
    "Endpoint",
    "Method",
    "Status Code",
    "Latency (ms)",
    "Error Message",
    "Response Size",
    "Source IP",
    "User Agent",
  ];

  const rows = items.map((item) => [
    item.id,
    item.createdAt.toISOString(),
    `"${item.endpoint}"`,
    item.method,
    item.statusCode,
    item.latencyMs,
    item.errorMessage ? `"${item.errorMessage.replace(/"/g, '"')}"` : "",
    item.responseSize ?? "",
    item.sourceIp ?? "",
    item.userAgent ? `"${item.userAgent.replace(/"/g, '"')}"` : "",
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ─── Recent Request Methods Distribution ──────────────────────────────

export interface MethodDistribution {
  method: string;
  count: number;
  percentage: number;
}

export async function getMethodDistribution(
  timeRange: TimeRange = "24h",
  userId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<MethodDistribution[]> {
  if (env.isDemoMode) return demoStore.methodDistribution(timeRange, userId, startDate, endDate);
  const db = getDb();
  const { since, until } = getDateBounds(timeRange, startDate, endDate);

  const results = await db
    .select({
      method: apiRequests.method,
      count: count(),
    })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, since),
        lte(apiRequests.createdAt, until),
      ),
    )
    .groupBy(apiRequests.method)
    .orderBy(desc(count()));

  const total = results.reduce((sum, r) => sum + r.count, 0);

  return results.map((r) => ({
    method: r.method,
    count: r.count,
    percentage: total > 0 ? Math.round((r.count / total) * 100 * 100) / 100 : 0,
  }));
}
