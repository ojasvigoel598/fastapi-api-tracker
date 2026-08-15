/**
 * Pure usage-limit helpers (no database, no demo store, no env access).
 * Shared by the MySQL query layer (`api/queries/usage.ts`) and the in-memory
 * demo store so threshold/percentage/status logic can never diverge.
 */

import type { ApiRequest, UsageAlert, UsageLimit } from "@db/schema";
import {
  periodKey,
  periodStart,
  dailyPeriodKey,
  monthlyPeriodKey,
  type UsagePeriod,
} from "./usage-periods";

export type LimitConfigInput = {
  dailyLimit?: number | null;
  monthlyLimit?: number | null;
  costLimit?: number | null;
  warningThreshold?: number;
  criticalThreshold?: number;
  emailAlerts?: boolean;
  rateLimiting?: boolean;
};

export type LimitStatus = "ok" | "warning" | "critical" | "limit";
export type AlertSeverity = "warning" | "critical" | "limit" | "reset";
export type UsageMetric = "daily" | "monthly" | "cost";

export type UsedCounts = { daily: number; monthly: number; cost: number };

export type PeriodUsage = {
  period: UsagePeriod | "cost";
  used: number;
  limit: number | null;
  percentage: number;
  remaining: number | null;
  resetAt: Date;
};

export type UsageLimitWithUsage = {
  id: number;
  endpoint: string;
  method: string;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  costLimit: number | null;
  warningThreshold: number;
  criticalThreshold: number;
  emailAlerts: boolean;
  rateLimiting: boolean;
  daily: PeriodUsage;
  monthly: PeriodUsage;
  cost: PeriodUsage;
  status: LimitStatus;
  rateLimited: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ThresholdOutcome = {
  period: UsagePeriod;
  metric: UsageMetric;
  severity: AlertSeverity;
  used: number;
  limit: number;
  percentage: number;
  message: string;
  details: Record<string, unknown>;
};

/** A telemetry request being recorded through the rate-limit gate. */
export type TrackedPayload = {
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  cost?: number;
  errorMessage?: string | null;
  requestHeaders?: Record<string, string> | null;
  responseSize?: number | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
};

export type EnforceResult = {
  allowed: boolean;
  request: ApiRequest;
  alerts: UsageAlert[];
  limit: UsageLimitWithUsage | null;
};

export function validateLimitConfig(input: LimitConfigInput): {
  dailyLimit: number | null;
  monthlyLimit: number | null;
  costLimit: number | null;
  warningThreshold: number;
  criticalThreshold: number;
  emailAlerts: boolean;
  rateLimiting: boolean;
} {
  const warning = input.warningThreshold ?? 80;
  const critical = input.criticalThreshold ?? 95;

  if (!Number.isFinite(warning) || warning <= 0 || warning > 100) {
    throw new Error("Warning threshold must be between 1 and 100.");
  }
  if (!Number.isFinite(critical) || critical <= 0 || critical > 100) {
    throw new Error("Critical threshold must be between 1 and 100.");
  }
  if (warning >= critical) {
    throw new Error("Warning threshold must be lower than the critical threshold.");
  }

  for (const [label, value] of [
    ["Daily limit", input.dailyLimit],
    ["Monthly limit", input.monthlyLimit],
    ["Cost limit", input.costLimit],
  ] as const) {
    if (
      value !== null &&
      value !== undefined &&
      (!Number.isFinite(value) || value < 0)
    ) {
      throw new Error(`${label} must be a non-negative number.`);
    }
  }

  const nonNegative = (n: number | null | undefined) =>
    n === null || n === undefined ? null : n;

  return {
    dailyLimit: nonNegative(input.dailyLimit),
    monthlyLimit: nonNegative(input.monthlyLimit),
    costLimit: nonNegative(input.costLimit),
    warningThreshold: warning,
    criticalThreshold: critical,
    emailAlerts: Boolean(input.emailAlerts),
    rateLimiting: Boolean(input.rateLimiting),
  };
}

export function percentage(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return (used / limit) * 100;
}

export function severityFor(
  pct: number,
  limit: number | null,
  warningThreshold: number,
  criticalThreshold: number,
): "none" | "warning" | "critical" | "limit" {
  if (limit === null || limit <= 0) return "none";
  if (pct >= 100) return "limit";
  if (pct >= criticalThreshold) return "critical";
  if (pct >= warningThreshold) return "warning";
  return "none";
}

export function metricLabel(metric: UsageMetric): string {
  return metric === "daily"
    ? "daily requests"
    : metric === "monthly"
      ? "monthly requests"
      : "monthly cost";
}

export function buildPeriodUsage(
  period: UsagePeriod | "cost",
  used: number,
  limit: number | null,
  now: Date,
): PeriodUsage {
  const pct = percentage(used, limit);
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    period,
    used,
    limit,
    percentage: Math.round(pct * 100) / 100,
    remaining: limit === null ? null : Math.max(0, limit - used),
    resetAt:
      period === "daily"
        ? new Date(periodStart("daily", now).getTime() + 24 * 60 * 60 * 1000)
        : nextMonth,
  };
}

export function toWithUsage(
  limit: UsageLimit,
  used: UsedCounts,
  now: Date,
): UsageLimitWithUsage {
  const daily = buildPeriodUsage("daily", used.daily, limit.dailyLimit, now);
  const monthly = buildPeriodUsage(
    "monthly",
    used.monthly,
    limit.monthlyLimit,
    now,
  );
  const cost = buildPeriodUsage("cost", used.cost, limit.costLimit, now);

  const sevs = [
    severityFor(daily.percentage, limit.dailyLimit, limit.warningThreshold, limit.criticalThreshold),
    severityFor(monthly.percentage, limit.monthlyLimit, limit.warningThreshold, limit.criticalThreshold),
    severityFor(cost.percentage, limit.costLimit, limit.warningThreshold, limit.criticalThreshold),
  ];

  let status: LimitStatus = "ok";
  if (sevs.includes("limit")) status = "limit";
  else if (sevs.includes("critical")) status = "critical";
  else if (sevs.includes("warning")) status = "warning";

  const limitReached =
    (limit.dailyLimit !== null && used.daily >= limit.dailyLimit) ||
    (limit.monthlyLimit !== null && used.monthly >= limit.monthlyLimit) ||
    (limit.costLimit !== null && used.cost >= limit.costLimit);

  return {
    id: limit.id,
    endpoint: limit.endpoint,
    method: limit.method,
    dailyLimit: limit.dailyLimit,
    monthlyLimit: limit.monthlyLimit,
    costLimit: limit.costLimit,
    warningThreshold: limit.warningThreshold,
    criticalThreshold: limit.criticalThreshold,
    emailAlerts: limit.emailAlerts === 1,
    rateLimiting: limit.rateLimiting === 1,
    daily,
    monthly,
    cost,
    status,
    rateLimited: limitReached,
    createdAt: limit.createdAt,
    updatedAt: limit.updatedAt,
  };
}

export function evaluateThresholds(
  limit: UsageLimit,
  used: UsedCounts,
  now: Date,
): ThresholdOutcome[] {
  const outcomes: ThresholdOutcome[] = [];
  const endpoint = limit.endpoint;

  const push = (
    metric: UsageMetric,
    period: UsagePeriod,
    usedValue: number,
    limitValue: number | null,
  ) => {
    const severity = severityFor(
      percentage(usedValue, limitValue),
      limitValue,
      limit.warningThreshold,
      limit.criticalThreshold,
    );
    if (severity === "none") return;
    const pct = percentage(usedValue, limitValue);
    const label = metricLabel(metric);
    outcomes.push({
      period,
      metric,
      severity: severity as AlertSeverity,
      used: usedValue,
      limit: limitValue as number,
      percentage: Math.round(pct * 100) / 100,
      message:
        severity === "limit"
          ? `${endpoint} ${label} hard limit reached (${usedValue}/${limitValue})`
          : `${endpoint} ${label} usage reached ${Math.round(pct)}% (${usedValue}/${limitValue})`,
      details: {
        endpoint,
        method: limit.method,
        metric,
        used: usedValue,
        limit: limitValue,
        percentage: Math.round(pct * 100) / 100,
        periodKey: periodKey(period, now),
      },
    });
  };

  push("daily", "daily", used.daily, limit.dailyLimit);
  push("monthly", "monthly", used.monthly, limit.monthlyLimit);
  push("cost", "monthly", used.cost, limit.costLimit);

  return outcomes;
}

export function evaluateResets(
  limit: UsageLimit,
  now: Date,
): ThresholdOutcome[] {
  const outcomes: ThresholdOutcome[] = [];
  const endpoint = limit.endpoint;

  const currentDaily = dailyPeriodKey(now);
  const currentMonthly = monthlyPeriodKey(now);

  if (limit.lastDailyPeriodKey && limit.lastDailyPeriodKey !== currentDaily) {
    outcomes.push({
      period: "daily",
      metric: "daily",
      severity: "reset",
      used: 0,
      limit: limit.dailyLimit ?? 0,
      percentage: 0,
      message: `${endpoint} daily usage reset for the new period (${currentDaily})`,
      details: {
        endpoint,
        method: limit.method,
        metric: "daily",
        previousPeriodKey: limit.lastDailyPeriodKey,
        periodKey: currentDaily,
      },
    });
  }

  if (
    limit.lastMonthlyPeriodKey &&
    limit.lastMonthlyPeriodKey !== currentMonthly
  ) {
    outcomes.push({
      period: "monthly",
      metric: "monthly",
      severity: "reset",
      used: 0,
      limit: limit.monthlyLimit ?? 0,
      percentage: 0,
      message: `${endpoint} monthly usage reset for the new period (${currentMonthly})`,
      details: {
        endpoint,
        method: limit.method,
        metric: "monthly",
        previousPeriodKey: limit.lastMonthlyPeriodKey,
        periodKey: currentMonthly,
      },
    });
  }

  return outcomes;
}
