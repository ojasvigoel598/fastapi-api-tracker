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
 *
 * Every route is authenticated and scoped to the signed-in user, so one user
 * can never read or mutate another user's monitoring data.
 */

import { z } from "zod";
import { TIME_RANGES } from "./queries/time-range";
import { createRouter, authedQuery } from "./middleware";
import {
  getOverviewMetrics,
  getRequestLogs,
  getRequestLogById,
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

const timeRangeSchema = z.enum(TIME_RANGES);
const dateRangeSchema = {
  timeRange: timeRangeSchema.optional().default("24h"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
};

function date(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

export const monitoringRouter = createRouter({
  // ─── Overview ─────────────────────────────────────────────────────

  overview: authedQuery
    .input(
      z.object({
        ...dateRangeSchema,
      }),
    )
    .query(({ input, ctx }) =>
      getOverviewMetrics(input.timeRange, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  // ─── Request Logs ─────────────────────────────────────────────────

  requests: authedQuery
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
      }),
    )
    .query(({ input, ctx }) =>
      getRequestLogs(
        {
          ...(input.filters ?? {}),
          startDate: date(input.filters?.startDate),
          endDate: date(input.filters?.endDate),
        } as RequestFilters,
        input.pagination ?? { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" },
        ctx.user.id,
      ),
    ),

  // ─── Failures (status >= 400) ──────────────────────────────────────

  failures: authedQuery
    .input(
      z.object({
        endpoint: z.string().optional(),
        method: z.string().optional(),
        timeRange: timeRangeSchema.optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(500).optional().default(30),
      }),
    )
    .query(({ input, ctx }) =>
      getRequestLogs(
        {
          endpoint: input.endpoint,
          method: input.method,
          timeRange: input.timeRange,
          startDate: date(input.startDate),
          endDate: date(input.endDate),
          minStatusCode: 400,
        },
        {
          page: input.page,
          pageSize: input.pageSize,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        ctx.user.id,
      ),
    ),

  requestDetail: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input, ctx }) => getRequestLogById(input.id, ctx.user.id)),

  // ─── Time Series Data ─────────────────────────────────────────────

  timeSeries: authedQuery
    .input(
      z.object({
        ...dateRangeSchema,
        groupBy: z.enum(["minute", "hour", "day"]).optional().default("hour"),
      }),
    )
    .query(({ input, ctx }) =>
      getRequestTimeSeries(input.timeRange, input.groupBy, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  // ─── Endpoints ────────────────────────────────────────────────────

  endpoints: authedQuery
    .input(
      z.object({
        ...dateRangeSchema,
        limit: z.number().min(1).max(100).optional(),
      }),
    )
    .query(({ input, ctx }) =>
      getEndpoints(input.timeRange, input.limit, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  // ─── Distributions ────────────────────────────────────────────────

  statusDistribution: authedQuery
    .input(
      z.object({
        ...dateRangeSchema,
      }),
    )
    .query(({ input, ctx }) =>
      getStatusCodeDistribution(input.timeRange, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  latencyDistribution: authedQuery
    .input(
      z.object({
        ...dateRangeSchema,
        endpoint: z.string().optional(),
      }),
    )
    .query(({ input, ctx }) =>
      getLatencyDistribution(input.timeRange, input.endpoint, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  methodDistribution: authedQuery
    .input(z.object({ ...dateRangeSchema }))
    .query(({ input, ctx }) =>
      getMethodDistribution(input.timeRange, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  // ─── Insights ─────────────────────────────────────────────────────

  insights: authedQuery
    .input(
      z.object({
        ...dateRangeSchema,
      }),
    )
    .query(({ input, ctx }) =>
      generateInsights(input.timeRange, ctx.user.id, date(input.startDate), date(input.endDate)),
    ),

  // ─── Alerts ───────────────────────────────────────────────────────

  alerts: authedQuery
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
        .optional(),
    )
    .query(({ input, ctx }) =>
      getAlerts(
        {
          severity: input?.severity,
          acknowledged: input?.acknowledged,
          type: input?.type,
        },
        ctx.user.id,
      ),
    ),

  acknowledgeAlert: authedQuery
    .input(z.object({ alertId: z.number() }))
    .mutation(({ input, ctx }) => acknowledgeAlert(input.alertId, ctx.user.id)),

  // ─── Export ───────────────────────────────────────────────────────

  export: authedQuery
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
      }),
    )
    .query(({ input, ctx }) =>
      exportRequests(
        {
          ...(input.filters ?? {}),
          startDate: date(input.filters?.startDate),
          endDate: date(input.filters?.endDate),
        } as RequestFilters,
        input.format,
        ctx.user.id,
      ),
    ),

  // ─── Create Request Log (for demo/mocking) ────────────────────────

  createLog: authedQuery
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
      }),
    )
    .mutation(({ input, ctx }) =>
      createRequestLog({
        ...input,
        userId: ctx.user.id,
        requestHeaders: {},
        createdAt: new Date(),
      }),
    ),

  // ─── Create Alert (for demo/mocking) ──────────────────────────────

  createAlert: authedQuery
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
        message: z.string().min(1).max(2_000),
        // Bounded so a hostile client cannot stash an unbounded object in a row.
        details: z
          .record(z.string().min(1).max(200), z.unknown())
          .refine((d) => Object.keys(d).length <= 50, "details supports at most 50 entries")
          .optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      createAlert({
        type: input.type,
        severity: input.severity,
        endpoint: input.endpoint,
        message: input.message,
        details: input.details,
        userId: ctx.user.id,
        acknowledged: 0,
        createdAt: new Date(),
      }),
    ),
});
