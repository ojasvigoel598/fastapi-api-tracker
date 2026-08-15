/**
 * Monitoring tRPC Router
 *
 * Provides type-safe API endpoints for:
 * - Dashboard overview metrics (KPI cards)
 * - Request logs with filtering and pagination
 * - Time-series data for charts
 * - Endpoint performance analytics
 * - Status code and latency distributions
 * - Automated insights generation
 * - Alert management
 * - Data export (CSV/JSON)
 */

import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import {
  getOverviewMetrics,
  getRequestLogs,
  getRequestTimeSeries,
  getEndpoints,
  getStatusCodeDistribution,
  getLatencyDistribution,
  getMethodDistribution,
  generateInsights,
  getAlerts,
  acknowledgeAlert,
  exportRequests,
  createRequestLog,
  createAlert,
  type RequestFilters,
} from "./queries/monitoring";

const timeRangeSchema = z.enum(["1h", "6h", "24h", "7d", "30d"]);

export const monitoringRouter = createRouter({
  // ─── Overview ─────────────────────────────────────────────────────

  overview: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("24h"),
      })
    )
    .query(({ input }) => getOverviewMetrics(input.timeRange)),

  // ─── Request Logs ─────────────────────────────────────────────────

  requests: publicQuery
    .input(
      z.object({
        filters: z
          .object({
            endpoint: z.string().optional(),
            method: z.string().optional(),
            statusCode: z.number().optional(),
            startDate: z.string().datetime().optional(),
            endDate: z.string().datetime().optional(),
            search: z.string().optional(),
            timeRange: timeRangeSchema.optional(),
          })
          .optional(),
        pagination: z
          .object({
            page: z.number().min(1).optional().default(1),
            pageSize: z.number().min(1).max(500).optional().default(50),
            sortBy: z.string().optional().default("createdAt"),
            sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
          })
          .optional(),
      })
    )
    .query(({ input }) =>
      getRequestLogs(
        (input.filters ?? {}) as RequestFilters,
        input.pagination ?? { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" }
      )
    ),

  // ─── Time Series Data ─────────────────────────────────────────────

  timeSeries: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("24h"),
        groupBy: z.enum(["minute", "hour", "day"]).optional().default("hour"),
      })
    )
    .query(({ input }) =>
      getRequestTimeSeries(input.timeRange, input.groupBy)
    ),

  // ─── Endpoints ────────────────────────────────────────────────────

  endpoints: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("24h"),
        limit: z.number().min(1).max(100).optional(),
      })
    )
    .query(({ input }) => getEndpoints(input.timeRange, input.limit)),

  // ─── Distributions ────────────────────────────────────────────────

  statusDistribution: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("24h"),
      })
    )
    .query(({ input }) => getStatusCodeDistribution(input.timeRange)),

  latencyDistribution: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("24h"),
        endpoint: z.string().optional(),
      })
    )
    .query(({ input }) =>
      getLatencyDistribution(input.timeRange, input.endpoint)
    ),

  methodDistribution: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("24h"),
      })
    )
    .query(({ input }) => getMethodDistribution(input.timeRange)),

  // ─── Insights ─────────────────────────────────────────────────────

  insights: publicQuery
    .input(
      z.object({
        timeRange: timeRangeSchema.optional().default("1h"),
      })
    )
    .query(({ input }) => generateInsights(input.timeRange)),

  // ─── Alerts ───────────────────────────────────────────────────────

  alerts: publicQuery
    .input(
      z
        .object({
          severity: z.enum(["critical", "warning", "info"]).optional(),
          acknowledged: z.boolean().optional(),
          type: z
            .enum([
              "failure_rate_spike",
              "latency_spike",
              "error_rate_threshold",
              "endpoint_down",
            ])
            .optional(),
        })
        .optional()
    )
    .query(({ input }) =>
      getAlerts({
        severity: input?.severity,
        acknowledged: input?.acknowledged,
        type: input?.type,
      })
    ),

  acknowledgeAlert: authedQuery
    .input(z.object({ alertId: z.number() }))
    .mutation(({ input, ctx }) =>
      acknowledgeAlert(input.alertId, ctx.user.id)
    ),

  // ─── Export ───────────────────────────────────────────────────────

  export: publicQuery
    .input(
      z.object({
        format: z.enum(["csv", "json"]),
        filters: z
          .object({
            endpoint: z.string().optional(),
            method: z.string().optional(),
            statusCode: z.number().optional(),
            startDate: z.string().datetime().optional(),
            endDate: z.string().datetime().optional(),
            search: z.string().optional(),
            timeRange: timeRangeSchema.optional(),
          })
          .optional(),
      })
    )
    .query(({ input }) =>
      exportRequests(
        (input.filters ?? {}) as RequestFilters,
        input.format
      )
    ),

  // ─── Create Request Log (for demo/mocking) ────────────────────────

  createLog: publicQuery
    .input(
      z.object({
        endpoint: z.string().min(1),
        method: z.string().min(1),
        statusCode: z.number().min(100).max(599),
        latencyMs: z.number().min(0),
        errorMessage: z.string().optional(),
        responseSize: z.number().optional(),
        sourceIp: z.string().optional(),
        userAgent: z.string().optional(),
      })
    )
    .mutation(({ input }) =>
      createRequestLog({
        ...input,
        requestHeaders: {},
        createdAt: new Date(),
      })
    ),

  // ─── Create Alert (for demo/mocking) ──────────────────────────────

  createAlert: publicQuery
    .input(
      z.object({
        type: z.enum([
          "failure_rate_spike",
          "latency_spike",
          "error_rate_threshold",
          "endpoint_down",
        ]),
        severity: z.enum(["critical", "warning", "info"]).optional().default("warning"),
        endpoint: z.string().optional(),
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input }) =>
      createAlert({
        type: input.type,
        severity: input.severity,
        endpoint: input.endpoint,
        message: input.message,
        details: input.details,
        acknowledged: 0,
        createdAt: new Date(),
      })
    ),
});
