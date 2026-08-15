/**
 * Usage Limits, Alerts & Rate-Limiting data layer.
 *
 * - Limits are persisted per (user, endpoint, method) in `usage_limits`.
 * - Usage is always derived from `api_requests` rows (blocked rows excluded),
 *   so counts are the source of truth and never drift.
 * - Threshold alerts are deduped by a unique (limitId, period, severity,
 *   periodKey) index: a threshold fires once per period, then can fire again
 *   after the usage period rolls over.
 * - Rate limiting is enforced atomically (row lock + transaction in MySQL, a
 *   mutex in demo mode) so concurrent requests cannot exceed the hard limit.
 */

import { and, eq, gte, lte, count, sum, desc } from "drizzle-orm";
import { getDb } from "./connection";
import { env } from "../lib/env";
import * as demoStore from "../demo/store";
import {
  usageLimits,
  usageAlerts,
  apiRequests,
  type UsageLimit,
  type UsageAlert,
} from "@db/schema";
import {
  periodKey,
  periodStart,
  dailyPeriodKey,
  monthlyPeriodKey,
} from "../lib/usage-periods";
import {
  validateLimitConfig,
  toWithUsage,
  evaluateThresholds,
  evaluateResets,
  type LimitConfigInput,
  type ThresholdOutcome,
  type UsedCounts,
  type UsageLimitWithUsage,
  type EnforceResult,
  type TrackedPayload,
} from "../lib/limits";
import {
  buildUsageAlertEmail,
  emailConfigured,
  sendEmail,
} from "../lib/email";
import { findUserById } from "./users";

// Re-export the shared types so the router has one import surface.
export type {
  LimitConfigInput,
  LimitStatus,
  AlertSeverity,
  PeriodUsage,
  UsageLimitWithUsage,
  ThresholdOutcome,
  UsedCounts,
} from "../lib/limits";

// ─── Usage computation ────────────────────────────────────────────────

export async function computeUsed(
  userId: number,
  endpoint: string,
  method: string,
  now: Date,
): Promise<UsedCounts> {
  if (env.isDemoMode) return demoStore.computeUsed(userId, endpoint, method, now);
  const db = getDb();
  const dayStart = periodStart("daily", now);
  const monthStart = periodStart("monthly", now);

  const [monthlyRow] = await db
    .select({
      monthly: count(),
      cost: sum(apiRequests.cost),
    })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        eq(apiRequests.endpoint, endpoint),
        eq(apiRequests.method, method),
        eq(apiRequests.blocked, 0),
        gte(apiRequests.createdAt, monthStart),
        lte(apiRequests.createdAt, now),
      ),
    );

  const [dailyRow] = await db
    .select({ daily: count() })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        eq(apiRequests.endpoint, endpoint),
        eq(apiRequests.method, method),
        eq(apiRequests.blocked, 0),
        gte(apiRequests.createdAt, dayStart),
        lte(apiRequests.createdAt, now),
      ),
    );

  return {
    daily: dailyRow?.daily ?? 0,
    monthly: monthlyRow?.monthly ?? 0,
    cost: Number(monthlyRow?.cost ?? 0),
  };
}

// ─── Limit config CRUD ────────────────────────────────────────────────

export async function listUsageLimits(
  userId: number,
): Promise<UsageLimitWithUsage[]> {
  if (env.isDemoMode) return demoStore.listUsageLimits(userId);
  const db = getDb();
  const limits = await db
    .select()
    .from(usageLimits)
    .where(eq(usageLimits.userId, userId))
    .orderBy(desc(usageLimits.updatedAt));

  const now = new Date();
  return Promise.all(
    limits.map(async (limit) =>
      toWithUsage(limit, await computeUsed(userId, limit.endpoint, limit.method, now), now),
    ),
  );
}

export async function getUsageLimit(
  userId: number,
  endpoint: string,
  method: string,
): Promise<UsageLimitWithUsage | null> {
  if (env.isDemoMode) return demoStore.getUsageLimit(userId, endpoint, method);
  const db = getDb();
  const rows = await db
    .select()
    .from(usageLimits)
    .where(
      and(
        eq(usageLimits.userId, userId),
        eq(usageLimits.endpoint, endpoint),
        eq(usageLimits.method, method),
      ),
    )
    .limit(1);
  const limit = rows.at(0);
  if (!limit) return null;
  const now = new Date();
  const used = await computeUsed(userId, endpoint, method, now);
  return toWithUsage(limit, used, now);
}

export async function saveUsageLimit(
  userId: number,
  endpoint: string,
  method: string,
  input: LimitConfigInput,
): Promise<UsageLimitWithUsage> {
  const config = validateLimitConfig(input);
  if (env.isDemoMode) return demoStore.saveUsageLimit(userId, endpoint, method, config);

  const db = getDb();
  const values = {
    userId,
    endpoint,
    method,
    dailyLimit: config.dailyLimit,
    monthlyLimit: config.monthlyLimit,
    costLimit: config.costLimit,
    warningThreshold: config.warningThreshold,
    criticalThreshold: config.criticalThreshold,
    emailAlerts: config.emailAlerts ? 1 : 0,
    rateLimiting: config.rateLimiting ? 1 : 0,
    updatedAt: new Date(),
  };

  await db
    .insert(usageLimits)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        dailyLimit: values.dailyLimit,
        monthlyLimit: values.monthlyLimit,
        costLimit: values.costLimit,
        warningThreshold: values.warningThreshold,
        criticalThreshold: values.criticalThreshold,
        emailAlerts: values.emailAlerts,
        rateLimiting: values.rateLimiting,
        updatedAt: values.updatedAt,
      },
    });

  return (await getUsageLimit(userId, endpoint, method)) as UsageLimitWithUsage;
}

export async function deleteUsageLimit(
  userId: number,
  endpoint: string,
  method: string,
): Promise<void> {
  if (env.isDemoMode) {
    demoStore.deleteUsageLimit(userId, endpoint, method);
    return;
  }
  const db = getDb();
  await db
    .delete(usageLimits)
    .where(
      and(
        eq(usageLimits.userId, userId),
        eq(usageLimits.endpoint, endpoint),
        eq(usageLimits.method, method),
      ),
    );
}

// ─── Alert persistence + email ────────────────────────────────────────

async function dashboardUrl(endpoint: string, method: string): Promise<string> {
  const base = env.appUrl || "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/limits?endpoint=${encodeURIComponent(endpoint)}&method=${encodeURIComponent(method)}`;
}

async function persistOutcome(
  userId: number,
  limit: UsageLimit,
  outcome: ThresholdOutcome,
  now: Date,
): Promise<UsageAlert | null> {
  const key = periodKey(outcome.period, now);

  if (env.isDemoMode) {
    return demoStore.createUsageAlert(userId, limit, outcome, key);
  }

  const db = getDb();
  const insert = () =>
    db.insert(usageAlerts).values({
      userId,
      limitId: limit.id,
      endpoint: limit.endpoint,
      method: limit.method,
      period: outcome.period,
      severity: outcome.severity,
      periodKey: key,
      message: outcome.message,
      details: outcome.details,
      emailed: 0,
    });

  try {
    const [result] = await insert().$returningId();
    const alert = await db.query.usageAlerts.findFirst({
      where: eq(usageAlerts.id, result.id),
    });
    if (!alert) return null;

    if (limit.emailAlerts === 1 && outcome.severity !== "reset") {
      const user = await findUserById(userId);
      if (user && emailConfigured()) {
        const url = await dashboardUrl(limit.endpoint, limit.method);
        const email = buildUsageAlertEmail({
          apiName: `${limit.method} ${limit.endpoint}`,
          endpoint: limit.endpoint,
          method: limit.method,
          period: outcome.period,
          severity: outcome.severity,
          used: outcome.used,
          limit: outcome.limit,
          percentage: outcome.percentage,
          occurredAt: now,
          nextSteps:
            outcome.severity === "limit"
              ? "Requests are being rejected (HTTP 429) until the usage period resets."
              : "Requests are still being accepted; configure a higher limit or enable rate limiting to enforce a hard stop.",
          dashboardUrl: url || "/limits",
        });
        email.to = user.email;
        const sendResult = await sendEmail(email);
        if (sendResult.sent) {
          await db
            .update(usageAlerts)
            .set({ emailed: 1 })
            .where(eq(usageAlerts.id, alert.id));
          alert.emailed = 1;
        }
      }
    }

    return alert;
  } catch (err) {
    // Duplicate key → the same threshold already fired this period. Skip.
    if (
      err instanceof Error &&
      /duplicate|ER_DUP_ENTRY|unique|ER_DUP/i.test(err.message)
    ) {
      return null;
    }
    throw err;
  }
}

async function updatePeriodKeys(limit: UsageLimit, now: Date): Promise<void> {
  if (env.isDemoMode) {
    demoStore.updatePeriodKeys(limit.id, dailyPeriodKey(now), monthlyPeriodKey(now));
    return;
  }
  const db = getDb();
  await db
    .update(usageLimits)
    .set({
      lastDailyPeriodKey: dailyPeriodKey(now),
      lastMonthlyPeriodKey: monthlyPeriodKey(now),
    })
    .where(eq(usageLimits.id, limit.id));
}

/**
 * After a request is recorded, evaluate thresholds and resets, persist
 * deduped alerts, and send emails. Safe to call on every request.
 */
export async function evaluateAndAlert(
  userId: number,
  limit: UsageLimit,
  now: Date,
): Promise<UsageAlert[]> {
  const used = await computeUsed(userId, limit.endpoint, limit.method, now);
  const outcomes = [
    ...evaluateResets(limit, now),
    ...evaluateThresholds(limit, used, now),
  ];

  const created: UsageAlert[] = [];
  for (const outcome of outcomes) {
    const alert = await persistOutcome(userId, limit, outcome, now);
    if (alert) created.push(alert);
  }

  await updatePeriodKeys(limit, now);
  return created;
}

export async function listUsageAlerts(userId: number): Promise<UsageAlert[]> {
  if (env.isDemoMode) return demoStore.listUsageAlerts(userId);
  const db = getDb();
  return db
    .select()
    .from(usageAlerts)
    .where(eq(usageAlerts.userId, userId))
    .orderBy(desc(usageAlerts.createdAt));
}

// ─── Rate-limit enforcement (atomic) ──────────────────────────────────

export type { EnforceResult, TrackedPayload } from "../lib/limits";

/**
 * Atomically enforce rate limits and record the request.
 *
 * - No limit config → record normally, no thresholds.
 * - Rate limiting enabled and hard limit reached → record a blocked 429 row.
 * - Otherwise → record the request and evaluate thresholds (fire alerts/emails).
 */
export async function enforceAndRecord(
  userId: number,
  payload: TrackedPayload,
  now: Date,
): Promise<EnforceResult> {
  if (env.isDemoMode) return demoStore.enforceAndRecord(userId, payload, now);

  const db = getDb();
  const createdAt = payload.createdAt ?? now;

  const recorded = await db.transaction(async (tx) => {
    const limitRows = await tx
      .select()
      .from(usageLimits)
      .where(
        and(
          eq(usageLimits.userId, userId),
          eq(usageLimits.endpoint, payload.endpoint),
          eq(usageLimits.method, payload.method),
        ),
      )
      .for("update");
    const limit = limitRows.at(0);

    let allowed = true;
    if (limit && limit.rateLimiting === 1) {
      const dayStart = periodStart("daily", now);
      const monthStart = periodStart("monthly", now);

      const [daily] = await tx
        .select({ n: count() })
        .from(apiRequests)
        .where(
          and(
            eq(apiRequests.userId, userId),
            eq(apiRequests.endpoint, payload.endpoint),
            eq(apiRequests.method, payload.method),
            eq(apiRequests.blocked, 0),
            gte(apiRequests.createdAt, dayStart),
            lte(apiRequests.createdAt, now),
          ),
        );

      const [monthly] = await tx
        .select({ n: count(), cost: sum(apiRequests.cost) })
        .from(apiRequests)
        .where(
          and(
            eq(apiRequests.userId, userId),
            eq(apiRequests.endpoint, payload.endpoint),
            eq(apiRequests.method, payload.method),
            eq(apiRequests.blocked, 0),
            gte(apiRequests.createdAt, monthStart),
            lte(apiRequests.createdAt, now),
          ),
        );

      const dailyUsed = daily?.n ?? 0;
      const monthlyUsed = monthly?.n ?? 0;
      const costUsed = Number(monthly?.cost ?? 0);

      const exhausted =
        (limit.dailyLimit !== null && dailyUsed >= limit.dailyLimit) ||
        (limit.monthlyLimit !== null && monthlyUsed >= limit.monthlyLimit) ||
        (limit.costLimit !== null && costUsed >= limit.costLimit);

      if (exhausted) allowed = false;
    }

    const row = {
      userId,
      endpoint: payload.endpoint,
      method: payload.method,
      statusCode: allowed ? payload.statusCode : 429,
      latencyMs: allowed ? payload.latencyMs : 0,
      errorMessage: allowed ? payload.errorMessage ?? null : "Rate limit exceeded",
      requestHeaders: payload.requestHeaders ?? null,
      responseSize: allowed ? payload.responseSize ?? null : null,
      sourceIp: payload.sourceIp ?? null,
      userAgent: payload.userAgent ?? null,
      cost: allowed ? payload.cost ?? 0 : 0,
      blocked: allowed ? 0 : 1,
      createdAt,
    };

    const [result] = await tx.insert(apiRequests).values(row).$returningId();
    const request = await tx.query.apiRequests.findFirst({
      where: eq(apiRequests.id, result.id),
    });
    if (!request) throw new Error("Failed to record request");
    return { allowed, request, limit };
  });

  let alerts: UsageAlert[] = [];
  let limitWithUsage: UsageLimitWithUsage | null = null;
  if (recorded.limit) {
    alerts = await evaluateAndAlert(userId, recorded.limit, now);
    const used = await computeUsed(userId, payload.endpoint, payload.method, now);
    limitWithUsage = toWithUsage(recorded.limit, used, now);
  }

  return {
    allowed: recorded.allowed,
    request: recorded.request,
    alerts,
    limit: limitWithUsage,
  };
}
