import { describe, expect, it } from "vitest";

// Same isolated env as app.test.ts — the offline suite must never depend
// on local credentials.
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

type Caller = ReturnType<
  Awaited<typeof import("./router")>["appRouter"]["createCaller"]
>;

// The demo store is module-level, so every test needs a distinct account.
let emailCounter = 0;

async function newAuthedCaller(): Promise<Caller> {
  const { appRouter } = await import("./router");
  const { authenticateRequest } = await import("./context");

  emailCounter += 1;
  let cookieHeader = "";
  const resHeaders = new Headers();

  async function build(): Promise<Caller> {
    const headers = new Headers();
    if (cookieHeader) headers.set("cookie", cookieHeader);
    const user = await authenticateRequest(headers);
    return appRouter.createCaller({
      req: new Request("http://localhost/api/trpc", { headers }),
      resHeaders,
      user,
    });
  }

  const caller = await build();
  await caller.auth.register({
    email: `webhooks${emailCounter}@example.com`,
    password: "password123",
  });
  const setCookie = resHeaders.get("set-cookie");
  const match = setCookie?.match(/app_sid=([^;]*)/);
  if (match?.[1]) cookieHeader = `app_sid=${match[1]}`;
  return build();
}

describe("webhook API keys", () => {
  it("creates a key, lists it, and never reveals it again", async () => {
    const caller = await newAuthedCaller();

    const created = await caller.webhooks.createKey({ name: "Gateway A" });
    expect(created.key.startsWith("apk_")).toBe(true);
    expect(created.key.length).toBeGreaterThan(20);
    expect(created.record.name).toBe("Gateway A");
    expect(created.record.keyHint).toBe(created.key.slice(-4));

    const list = await caller.webhooks.listKeys();
    expect(list.length).toBe(1);
    // Only the hint is stored/returned, never the full key.
    expect(list[0]?.keyHint).toBe(created.record.keyHint);
    expect(JSON.stringify(list)).not.toContain(created.key);
  });

  it("records telemetry through the webhook with a bearer key", async () => {
    const { handleWebhookIngest } = await import("./webhook");
    const caller = await newAuthedCaller();
    const { key } = await caller.webhooks.createKey({ name: "Gateway B" });

    const response = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "user-agent": "webhook-test-client",
        },
        body: JSON.stringify({
          endpoint: "/webhook-created",
          method: "post",
          statusCode: 202,
          latencyMs: 77,
          responseSize: 256,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { ok: boolean; received: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.received.length).toBe(1);

    const logs = await caller.monitoring.requests({
      filters: { endpoint: "/webhook-created" },
    });
    expect(logs.total).toBe(1);
    expect(logs.items[0]?.statusCode).toBe(202);
    expect(logs.items[0]?.latencyMs).toBe(77);
  });

  it("accepts a batch of events in a single request", async () => {
    const { handleWebhookIngest } = await import("./webhook");
    const caller = await newAuthedCaller();
    const { key } = await caller.webhooks.createKey({ name: "Batch" });

    const response = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          events: [
            { endpoint: "/batch-1", method: "GET", statusCode: 200, latencyMs: 10 },
            { endpoint: "/batch-2", method: "POST", statusCode: 201, latencyMs: 20 },
          ],
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { received: { endpoint: string }[] };
    expect(body.received.map((r) => r.endpoint)).toEqual(["/batch-1", "/batch-2"]);
  });

  it("rejects missing, invalid, and revoked keys", async () => {
    const { handleWebhookIngest } = await import("./webhook");
    const caller = await newAuthedCaller();
    const { key, record } = await caller.webhooks.createKey({ name: "Revoke me" });

    const payload = JSON.stringify({
      endpoint: "/x",
      method: "GET",
      statusCode: 200,
      latencyMs: 1,
    });

    const noKey = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        body: payload,
      }),
    );
    expect(noKey.status).toBe(401);

    const badKey = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers: { authorization: "Bearer apk_not-a-real-key" },
        body: payload,
      }),
    );
    expect(badKey.status).toBe(401);

    await caller.webhooks.revokeKey({ id: record.id });
    const revoked = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: payload,
      }),
    );
    expect(revoked.status).toBe(401);
  });

  it("validates the payload and rejects malformed bodies", async () => {
    const { handleWebhookIngest } = await import("./webhook");
    const caller = await newAuthedCaller();
    const { key } = await caller.webhooks.createKey({ name: "Strict" });
    const headers = {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    };

    const badJson = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers,
        body: "{not-json",
      }),
    );
    expect(badJson.status).toBe(400);

    const badPayload = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers,
        body: JSON.stringify({ endpoint: "", method: "GET", statusCode: 200, latencyMs: 1 }),
      }),
    );
    expect(badPayload.status).toBe(400);

    const badBatch = await handleWebhookIngest(
      new Request("http://localhost/api/webhook/ingest", {
        method: "POST",
        headers,
        body: JSON.stringify({ events: [] }),
      }),
    );
    expect(badBatch.status).toBe(400);
  });

  it("never over-counts under concurrent ingests once a rate limit is hit", async () => {
    // The demo store enforces rate limits with a per-key mutex; concurrent
    // webhook ingests must be serialized so exactly `limit` pass.
    const { handleWebhookIngest } = await import("./webhook");
    const caller = await newAuthedCaller();
    const { key } = await caller.webhooks.createKey({ name: "Race" });

    const endpoint = `/rl-webhook-${Date.now()}`;
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

    const fire = () =>
      handleWebhookIngest(
        new Request("http://localhost/api/webhook/ingest", {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ endpoint, method: "GET", statusCode: 200, latencyMs: 5 }),
        }),
      );

    const results = await Promise.all(Array.from({ length: 8 }, fire));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("exercises the full webhook flow over HTTP (login → key → ingest → query)", async () => {
    // Boot the real app (boot.ts wiring: body guard, /api/trpc, webhook
    // route) and drive everything through app.request — this is the same
    // surface a real API gateway hits.
    const { default: app } = await import("./boot");

    const loginRes = await app.request("/api/trpc/auth.login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: { email: "demo@example.com", password: "demo1234" },
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as {
      result: { data: { json: { token: string } } };
    };
    const token = loginBody.result.data.json.token;

    const keyRes = await app.request("/api/trpc/webhooks.createKey", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ json: { name: "HTTP e2e gateway" } }),
    });
    expect(keyRes.status).toBe(200);
    const keyBody = (await keyRes.json()) as {
      result: { data: { json: { key: string } } };
    };
    const key = keyBody.result.data.json.key;

    const ingestRes = await app.request("/api/webhook/ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "/http-e2e-webhook",
        method: "POST",
        statusCode: 201,
        latencyMs: 25,
      }),
    });
    expect(ingestRes.status).toBe(201);

    // The recorded row must be visible through the signed-in monitoring query.
    const input = encodeURIComponent(
      JSON.stringify({ json: { filters: { endpoint: "/http-e2e-webhook" } } }),
    );
    const queryRes = await app.request(
      `/api/trpc/monitoring.requests?input=${input}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(queryRes.status).toBe(200);
    const queryBody = (await queryRes.json()) as {
      result: { data: { json: { total: number; items: { latencyMs: number }[] } } };
    };
    expect(queryBody.result.data.json.total).toBe(1);
    expect(queryBody.result.data.json.items[0]?.latencyMs).toBe(25);
  });
});
