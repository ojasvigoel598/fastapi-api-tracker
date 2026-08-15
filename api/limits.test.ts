import { describe, expect, it } from "vitest";

// Same isolation as app.test.ts: force the offline demo store regardless of
// any developer credentials present in ignored env files.
process.env.NODE_ENV = "test";
process.env.DEMO_MODE = "true";
process.env.DATABASE_URL = "";
process.env.APP_SECRET = "unit-test-secret-key-that-is-long-enough-for-hs256";
process.env.OWNER_EMAIL = "";
process.env.OWNER_PASSWORD = "";
process.env.CLERK_SECRET_KEY = "";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.SUPABASE_JWT_SECRET = "";
process.env.KIMI_OPEN_URL = "";
process.env.KIMI_API_KEY = "";
process.env.RESEND_API_KEY = "";
process.env.RESEND_FROM = "";

import type { UsageLimit } from "@db/schema";
import {
  evaluateResets,
  evaluateThresholds,
  percentage,
  severityFor,
  validateLimitConfig,
} from "./lib/limits";
import { dailyPeriodKey, monthlyPeriodKey } from "./lib/usage-periods";

function baseLimit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    id: 1,
    userId: 1,
    endpoint: "/test",
    method: "GET",
    dailyLimit: 10,
    monthlyLimit: null,
    costLimit: null,
    warningThreshold: 50,
    criticalThreshold: 80,
    emailAlerts: 0,
    rateLimiting: 1,
    lastDailyPeriodKey: null,
    lastMonthlyPeriodKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("usage limit pure helpers", () => {
  it("computes percentages and severities", () => {
    expect(percentage(5, 10)).toBe(50);
    expect(percentage(0, 0)).toBe(0);
    expect(percentage(12, null)).toBe(0);
    expect(severityFor(49, 10, 50, 80)).toBe("none");
    expect(severityFor(50, 10, 50, 80)).toBe("warning");
    expect(severityFor(80, 10, 50, 80)).toBe("critical");
    expect(severityFor(99.9, 10, 50, 80)).toBe("critical");
    expect(severityFor(100, 10, 50, 80)).toBe("limit");
    expect(severityFor(500, null, 50, 80)).toBe("none");
  });

  it("validates limit configuration", () => {
    expect(() =>
      validateLimitConfig({ warningThreshold: 80, criticalThreshold: 50 }),
    ).toThrow(/Warning threshold must be lower/);
    expect(() => validateLimitConfig({ dailyLimit: -1 })).toThrow(
      /non-negative/,
    );
    expect(() => validateLimitConfig({ warningThreshold: 101 })).toThrow(
      /between 1 and 100/,
    );
    const ok = validateLimitConfig({ dailyLimit: 5, costLimit: 1.5 });
    expect(ok.dailyLimit).toBe(5);
    expect(ok.warningThreshold).toBe(80);
    expect(ok.criticalThreshold).toBe(95);
  });

  it("evaluates warning, critical, and limit thresholds per metric", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const warn = evaluateThresholds(
      baseLimit(),
      { daily: 5, monthly: 0, cost: 0 },
      now,
    );
    expect(warn).toHaveLength(1);
    expect(warn[0].severity).toBe("warning");
    expect(warn[0].metric).toBe("daily");

    const crit = evaluateThresholds(
      baseLimit(),
      { daily: 8, monthly: 0, cost: 0 },
      now,
    );
    expect(crit[0].severity).toBe("critical");

    const limit = evaluateThresholds(
      baseLimit(),
      { daily: 10, monthly: 0, cost: 0 },
      now,
    );
    expect(limit[0].severity).toBe("limit");

    // Over the limit still reports the hard-limit severity, not critical.
    const over = evaluateThresholds(
      baseLimit(),
      { daily: 12, monthly: 0, cost: 0 },
      now,
    );
    expect(over[0].severity).toBe("limit");

    // Unconfigured metrics never produce outcomes.
    expect(
      evaluateThresholds(baseLimit(), { daily: 0, monthly: 0, cost: 0 }, now),
    ).toHaveLength(0);
  });

  it("detects a usage-period reset from stale period keys", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const stale = baseLimit({ lastDailyPeriodKey: "2020-01-01" });
    const resets = evaluateResets(stale, now);
    expect(resets).toHaveLength(1);
    expect(resets[0].severity).toBe("reset");
    expect(resets[0].period).toBe("daily");

    // Fresh keys → no reset alerts.
    const fresh = baseLimit({
      lastDailyPeriodKey: dailyPeriodKey(now),
      lastMonthlyPeriodKey: monthlyPeriodKey(now),
    });
    expect(evaluateResets(fresh, now)).toHaveLength(0);
  });
});

describe("usage limits integration (demo store)", () => {
  type Caller = ReturnType<
    Awaited<typeof import("./router")>["appRouter"]["createCaller"]
  >;

  async function authedSession(): Promise<{
    caller: Caller;
    cookieHeader: string;
  }> {
    const { appRouter } = await import("./router");
    const { authenticateRequest } = await import("./context");
    let cookieHeader = "";
    let resHeaders = new Headers();

    async function build(): Promise<Caller> {
      const headers = new Headers();
      if (cookieHeader) headers.set("cookie", cookieHeader);
      resHeaders = new Headers();
      const user = await authenticateRequest(headers);
      return appRouter.createCaller({
        req: new Request("http://localhost/api/trpc", { headers }),
        resHeaders,
        user,
      });
    }

    let caller = await build();
    const email = `limits-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await caller.auth.register({ email, password: "password123" });
    const setCookie = resHeaders.get("set-cookie");
    const m = setCookie?.match(/app_sid=([^;]*)/);
    cookieHeader = m?.[1] ? `app_sid=${m[1]}` : "";
    caller = await build();
    return { caller, cookieHeader };
  }

  async function ingest(
    cookieHeader: string,
    endpoint: string,
    method: string,
    statusCode = 200,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const { handleIngest } = await import("./ingest");
    const response = await handleIngest(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: {
          cookie: cookieHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          endpoint,
          method,
          statusCode,
          latencyMs: 10,
        }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it("enforces a daily hard limit and records blocked requests without counting them", async () => {
    const { caller, cookieHeader } = await authedSession();
    const endpoint = `/rl-${Date.now()}`;

    const saved = await caller.limits.save({
      endpoint,
      method: "GET",
      config: {
        dailyLimit: 3,
        monthlyLimit: null,
        costLimit: null,
        warningThreshold: 50,
        criticalThreshold: 80,
        emailAlerts: false,
        rateLimiting: true,
      },
    });
    expect(saved.daily.limit).toBe(3);

    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await ingest(cookieHeader, endpoint, "GET");
      results.push(res.status);
    }
    expect(results).toEqual([201, 201, 201, 429, 429]);

    const [limit] = await caller.limits.list();
    expect(limit.daily.used).toBe(3);
    expect(limit.daily.percentage).toBe(100);
    expect(limit.status).toBe("limit");
    expect(limit.rateLimited).toBe(true);
  });

  it("fires warning and limit alerts exactly once per period (dedupe)", async () => {
    const { caller, cookieHeader } = await authedSession();
    const endpoint = `/dedupe-${Date.now()}`;

    await caller.limits.save({
      endpoint,
      method: "GET",
      config: {
        dailyLimit: 2,
        monthlyLimit: null,
        costLimit: null,
        warningThreshold: 50,
        criticalThreshold: 80,
        emailAlerts: false,
        rateLimiting: false,
      },
    });

    // Push past the limit multiple times; each threshold should fire once.
    for (let i = 0; i < 4; i++) {
      await ingest(cookieHeader, endpoint, "GET");
    }

    const alerts = await caller.limits.alerts();
    const forEndpoint = alerts.filter((a) => a.endpoint === endpoint);
    const severities = new Set(forEndpoint.map((a) => a.severity));
    expect(severities.has("warning")).toBe(true);
    expect(severities.has("limit")).toBe(true);
    // No duplicate warning/limit rows for the same period key.
    expect(
      forEndpoint.filter((a) => a.severity === "warning"),
    ).toHaveLength(1);
    expect(
      forEndpoint.filter((a) => a.severity === "limit"),
    ).toHaveLength(1);
  });

  it("does not over-count under concurrent requests (race safety)", async () => {
    const { caller, cookieHeader } = await authedSession();
    const endpoint = `/race-${Date.now()}`;

    await caller.limits.save({
      endpoint,
      method: "GET",
      config: {
        dailyLimit: 3,
        monthlyLimit: null,
        costLimit: null,
        warningThreshold: 50,
        criticalThreshold: 80,
        emailAlerts: false,
        rateLimiting: true,
      },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => ingest(cookieHeader, endpoint, "GET")),
    );
    const allowed = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 429).length;
    expect(allowed).toBe(3);
    expect(blocked).toBe(5);

    const [limit] = await caller.limits.list();
    expect(limit.daily.used).toBe(3);
  });

  it("isolates limits and alerts between users", async () => {
    const a = await authedSession();
    const b = await authedSession();
    const endpoint = `/isolated-${Date.now()}`;

    await a.caller.limits.save({
      endpoint,
      method: "GET",
      config: {
        dailyLimit: 1,
        monthlyLimit: null,
        costLimit: null,
        warningThreshold: 50,
        criticalThreshold: 80,
        emailAlerts: false,
        rateLimiting: true,
      },
    });

    // Bob must not see Alice's limit or be affected by it.
    const bobLimits = await b.caller.limits.list();
    expect(bobLimits).toHaveLength(0);

    const bobIngest = await ingest(b.cookieHeader, endpoint, "GET");
    expect(bobIngest.status).toBe(201);

    const aLimits = await a.caller.limits.list();
    expect(aLimits).toHaveLength(1);
    expect(aLimits[0].endpoint).toBe(endpoint);
  });

  it("removes a limit config", async () => {
    const { caller } = await authedSession();
    const endpoint = `/remove-${Date.now()}`;

    await caller.limits.save({
      endpoint,
      method: "GET",
      config: {
        dailyLimit: 5,
        monthlyLimit: null,
        costLimit: null,
        warningThreshold: 50,
        criticalThreshold: 80,
        emailAlerts: false,
        rateLimiting: false,
      },
    });
    expect(await caller.limits.list()).toHaveLength(1);

    await caller.limits.remove({ endpoint, method: "GET" });
    expect(await caller.limits.list()).toHaveLength(0);
  });
});
