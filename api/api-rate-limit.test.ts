import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./lib/rate-limit";

// Same isolated env as app.test.ts — the offline suite must never depend on
// local credentials. Tight budgets make the blocking paths reachable without
// looping hundreds of times.
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
process.env.RATE_LIMIT_WEBHOOK_PER_MIN = "2";
process.env.RATE_LIMIT_REPLAY_PER_MIN = "2";
process.env.RATE_LIMIT_KIMI_PER_HOUR = "2";
process.env.RATE_LIMIT_SEED_PER_HOUR = "2";
process.env.RATE_LIMIT_EXPORT_PER_MIN = "2";

type App = Awaited<typeof import("./boot")>["default"];

let appPromise: Promise<App> | undefined;

function bootApp(): Promise<App> {
  appPromise ??= import("./boot").then((m) => m.default);
  return appPromise;
}

async function demoSession(app: App): Promise<string> {
  const login = await app.request("/api/trpc/auth.login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      json: { email: "demo@example.com", password: "demo1234" },
    }),
  });
  expect(login.status).toBe(200);
  const body = (await login.json()) as {
    result: { data: { json: { token: string } } };
  };
  return body.result.data.json.token;
}

async function createWebhookKey(app: App, token: string): Promise<string> {
  const keyRes = await app.request("/api/trpc/webhooks.createKey", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ json: { name: "rate-limit test gateway" } }),
  });
  expect(keyRes.status).toBe(200);
  const body = (await keyRes.json()) as {
    result: { data: { json: { key: string } } };
  };
  return body.result.data.json.key;
}

function ingestRequest(key: string, endpoint: string): Request {
  return new Request("http://localhost/api/webhook/ingest", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      endpoint,
      method: "GET",
      statusCode: 200,
      latencyMs: 5,
    }),
  });
}

describe("FixedWindowRateLimiter.consume", () => {
  it("allows exactly the budget then blocks with a retry-after", () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    const now = 1_000_000;

    expect(limiter.consume("a", now)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume("a", now)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume("a", now)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    const blocked = limiter.consume("a", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);

    // A different key is unaffected.
    expect(limiter.consume("b", now).allowed).toBe(true);
  });

  it("resets after the window rolls over", () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);
    const now = 1_000_000;
    expect(limiter.consume("a", now).allowed).toBe(true);
    expect(limiter.consume("a", now).allowed).toBe(false);
    expect(limiter.consume("a", now + 60_001).allowed).toBe(true);
  });
});

describe("webhook ingest abuse limiting (HTTP)", () => {
  it("rejects with 429 + retry-after once the per-key budget is spent", async () => {
    const app = await bootApp();
    const token = await demoSession(app);
    const key = await createWebhookKey(app, token);
    const endpoint = `/rl-http-${Date.now()}`;

    const first = await app.request("/api/webhook/ingest", ingestRequest(key, endpoint));
    expect(first.status).toBe(201);

    const second = await app.request("/api/webhook/ingest", ingestRequest(key, endpoint));
    expect(second.status).toBe(201);

    const third = await app.request("/api/webhook/ingest", ingestRequest(key, endpoint));
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
    const body = (await third.json()) as { error: string };
    expect(body.error).toBe("Rate limit exceeded");

    // The budget is per key AND per source IP: a different key from the same
    // IP is blocked once the IP budget is spent, but a key from a fresh IP
    // still has its own allowance.
    const key2 = await createWebhookKey(app, token);
    const other = await app.request("/api/webhook/ingest", ingestRequest(key2, endpoint));
    expect(other.status).toBe(429);

    const freshIp = await app.request(
      "/api/webhook/ingest",
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key2}`,
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9",
        },
        body: JSON.stringify({
          endpoint,
          method: "GET",
          statusCode: 200,
          latencyMs: 5,
        }),
      }),
    );
    expect(freshIp.status).toBe(201);
  });

  it("keyless requests still 401 before any rate-limit accounting", async () => {
    const app = await bootApp();
    const res = await app.request(
      "/api/webhook/ingest",
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: "/x", method: "GET", statusCode: 200, latencyMs: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("tRPC surface rate limits (HTTP)", () => {
  async function callTrpc(
    app: App,
    token: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return app.request(`/api/trpc/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify({ json: body }),
    });
  }

  // tRPC v11 serves queries over GET with the input in the query string.
  async function getTrpc(
    app: App,
    token: string,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const input = encodeURIComponent(JSON.stringify({ json: body }));
    return app.request(`/api/trpc/${path}?input=${input}`, {
      headers: { authorization: `Bearer ${token}`, ...extraHeaders },
    });
  }

  it("kimi.analyze is limited to the per-hour budget", async () => {
    const app = await bootApp();
    const token = await demoSession(app);

    expect((await callTrpc(app, token, "kimi.analyze")).status).toBe(200);
    expect((await callTrpc(app, token, "kimi.analyze")).status).toBe(200);
    const third = await callTrpc(app, token, "kimi.analyze");
    expect(third.status).toBe(429);
    const body = (await third.json()) as {
      error: { json: { message: string } };
    };
    expect(body.error.json.message).toContain("limited to");
  });

  it("seed.generate is limited to the per-hour budget", async () => {
    const app = await bootApp();
    const token = await demoSession(app);

    expect((await callTrpc(app, token, "seed.generate", { count: 10 })).status).toBe(200);
    expect((await callTrpc(app, token, "seed.generate", { count: 10 })).status).toBe(200);
    const third = await callTrpc(app, token, "seed.generate", { count: 10 });
    expect(third.status).toBe(429);
    const body = (await third.json()) as {
      error: { json: { message: string } };
    };
    expect(body.error.json.message).toContain("limited to");
  });

  it("export is limited to the per-minute budget", async () => {
    const app = await bootApp();
    const token = await demoSession(app);

    const exportCall = () =>
      getTrpc(app, token, "monitoring.export", { format: "json" });
    expect((await exportCall()).status).toBe(200);
    expect((await exportCall()).status).toBe(200);
    expect((await exportCall()).status).toBe(429);

    // The user-level budget is authoritative: even a fresh IP is blocked
    // because this user already spent the per-minute allowance.
    const fresh = await getTrpc(app, token, "monitoring.export", { format: "json" }, {
      "x-forwarded-for": "203.0.113.42",
    });
    expect(fresh.status).toBe(429);
  });

  it("ordinary read queries are not rate limited", async () => {
    const app = await bootApp();
    const token = await demoSession(app);

    // The overview query has no budget — 5 rapid calls all succeed.
    for (let i = 0; i < 5; i += 1) {
      const res = await getTrpc(app, token, "monitoring.overview", { timeRange: "24h" });
      expect(res.status).toBe(200);
    }
  });
});
