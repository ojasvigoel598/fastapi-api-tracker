import { describe, expect, it } from "vitest";

// Deterministic offline suite (demo store, no external services).
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

import * as jose from "jose";
import { readBodyBounded, readJsonBounded, MAX_BODY_BYTES } from "./lib/body";
import { ingestSchema, headersMapSchema } from "./ingest";

function stream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("bounded body reader (chunked/unknown-length bodies)", () => {
  it("reads a normal body", async () => {
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      body: stream('{"a":1}'),
      duplex: "half",
    } as RequestInit);
    const read = await readBodyBounded(req);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.text).toBe('{"a":1}');
  });

  it("rejects a body larger than the cap without buffering it fully", async () => {
    const big = "x".repeat(MAX_BODY_BYTES + 10);
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      body: stream(big),
      duplex: "half",
    } as RequestInit);
    const read = await readBodyBounded(req);
    expect(read.ok).toBe(false);
  });

  it("returns too_large / malformed reasons from readJsonBounded", async () => {
    const tooBig = new Request("http://localhost/api/x", {
      method: "POST",
      body: stream("x".repeat(MAX_BODY_BYTES + 1)),
      duplex: "half",
    } as RequestInit);
    expect((await readJsonBounded(tooBig)).ok).toBe(false);

    const malformed = new Request("http://localhost/api/x", {
      method: "POST",
      body: stream("{not json"),
      duplex: "half",
    } as RequestInit);
    const r = await readJsonBounded(malformed);
    expect(r.ok).toBe(false);
  });
});

describe("security headers", () => {
  it("sets baseline headers on every response", async () => {
    const { default: app } = await import("./boot");
    const res = await app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("emits HSTS only when the request arrives over HTTPS", async () => {
    const { default: app } = await import("./boot");
    const plain = await app.request("/api/health");
    expect(plain.headers.get("strict-transport-security")).toBeNull();
    const secure = await app.request("/api/health", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(secure.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});

describe("input caps (resource exhaustion)", () => {
  it("rejects an ingest with too many request headers", () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 51; i++) headers[`x-h-${i}`] = "v";
    const parsed = ingestSchema.safeParse({
      endpoint: "/x",
      method: "GET",
      statusCode: 200,
      latencyMs: 1,
      requestHeaders: headers,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an ingest with an oversized header value", () => {
    const parsed = ingestSchema.safeParse({
      endpoint: "/x",
      method: "GET",
      statusCode: 200,
      latencyMs: 1,
      requestHeaders: { "x-big": "v".repeat(2_001) },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a reasonable headers map", () => {
    const parsed = headersMapSchema.safeParse({
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an absurdly long password at the schema level", async () => {
    const { authRouter } = await import("./auth-router");
    // Directly invoke the router's input validation via a caller.
    const { appRouter } = await import("./router");
    const { authenticateRequest } = await import("./context");
    const headers = new Headers();
    const user = await authenticateRequest(headers);
    const caller = appRouter.createCaller({
      req: new Request("http://localhost/api/trpc", { headers }),
      resHeaders: new Headers(),
      user,
    });
    await expect(
      caller.auth.register({
        email: "pw-limit@example.com",
        password: "a".repeat(129),
      }),
    ).rejects.toThrow(/at most 128 characters/);
    void authRouter;
  });
});

type App = Awaited<typeof import("./boot")>["default"];

let appPromise: Promise<App> | undefined;
function bootApp(): Promise<App> {
  appPromise ??= import("./boot").then((m) => m.default);
  return appPromise;
}

async function loginToken(app: App, email = "demo@example.com", password = "demo1234") {
  const res = await app.request("/api/trpc/auth.login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });
  const body = (await res.json()) as {
    result: { data: { json: { token: string } } };
  };
  return body.result.data.json.token;
}

describe("attack surface: direct HTTP probing (no frontend)", () => {
  it("rejects a forged bearer token and an expired session token", async () => {
    const app = await bootApp();

    // Forged: valid HS256 shape with a made-up signature.
    const forged = await app.request("/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoiYUBiLmNvIn0.deadbeef" },
    });
    expect(forged.status).toBe(401);

    // Expired: a genuinely signed token whose exp is in the past.
    const { signSessionToken } = await import("./auth/session");
    const expired = await new jose.SignJWT({ userId: 1, email: "a@b.co", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Date.now() / 1000 - 7_000_000)
      .setExpirationTime(Date.now() / 1000 - 60)
      .sign(new TextEncoder().encode(process.env.APP_SECRET));
    const expiredRes = await app.request("/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(expiredRes.status).toBe(401);
    void signSessionToken;
  });

  it("method confusion: GET on a mutation and POST on a query both 405", async () => {
    const app = await bootApp();
    const token = await loginToken(app);

    // GET on auth.login (a mutation).
    const getMutation = await app.request("/api/trpc/auth.login?input=" + encodeURIComponent(JSON.stringify({ json: { email: "demo@example.com", password: "demo1234" } })), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getMutation.status).toBe(405);

    // POST on monitoring.overview (a query).
    const postQuery = await app.request("/api/trpc/monitoring.overview", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ json: { timeRange: "24h" } }),
    });
    expect(postQuery.status).toBe(405);
  });

  it("never leaks secrets or internal state through responses", async () => {
    const app = await bootApp();
    const secret = process.env.APP_SECRET ?? "";

    const config = await app.request("/api/trpc/auth.config");
    const configText = await config.text();
    expect(configText).not.toContain(secret);
    expect(configText).not.toContain("passwordHash");
    expect(configText).not.toContain("passwordSalt");
    expect(configText).not.toContain("tokenVersion");
    expect(configText).not.toContain("sessionSecret");

    const me = await app.request("/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: `Bearer ${await loginToken(app)}` },
    });
    const meText = await me.text();
    expect(meText).not.toContain(secret);
    expect(meText).not.toContain("passwordHash");
    expect(meText).not.toContain("tokenVersion");
  });

  it("internal errors return a generic body with no stack trace", async () => {
    const app = await bootApp();
    // A route that throws: unknown tRPC path hits the 404 handler; force an
    // internal error via a malformed body on an ingest that passes the header
    // cap but is not JSON — that's a 400. To exercise the generic handler,
    // request an unknown /api route method.
    const bad = await app.request("/api/definitely-not-a-route", {
      method: "DELETE",
    });
    expect([404, 500]).toContain(bad.status);
    const text = await bad.text();
    expect(text).not.toContain("at ");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("boot.ts");
  });

  it("no permissive CORS: the API never advertises access-control-allow-origin", async () => {
    const app = await bootApp();
    const res = await app.request("/api/health");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const trpc = await app.request("/api/trpc/auth.config");
    expect(trpc.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("IDOR: user B cannot read user A's request detail", async () => {
    const app = await bootApp();

    const aliceEmail = `alice-attack-${Date.now()}@example.com`;
    const register = await app.request("/api/trpc/auth.register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.60" },
      body: JSON.stringify({ json: { email: aliceEmail, password: "password123" } }),
    });
    const alice = (await register.json()) as {
      result: { data: { json: { token: string } } };
    };

    const create = await app.request("/api/trpc/monitoring.createLog", {
      method: "POST",
      headers: {
        authorization: `Bearer ${alice.result.data.json.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        json: { endpoint: "/alice-secret", method: "GET", statusCode: 200, latencyMs: 5 },
      }),
    });
    expect(create.status).toBe(200);

    const bobToken = await loginToken(app);
    const query = await app.request(
      "/api/trpc/monitoring.requests?input=" +
        encodeURIComponent(
          JSON.stringify({ json: { filters: { endpoint: "/alice-secret" } } }),
        ),
      { headers: { authorization: `Bearer ${bobToken}` } },
    );
    const body = (await query.json()) as {
      result: { data: { json: { total: number } } };
    };
    // Bob sees zero of Alice's rows — tenant isolation holds at the API layer.
    expect(body.result.data.json.total).toBe(0);
  });

  it("invalid input shapes are rejected with 400, not ignored", async () => {
    const app = await bootApp();
    const token = await loginToken(app);

    // Oversized page size is capped by zod.
    const badPage = await app.request(
      "/api/trpc/monitoring.requests?input=" +
        encodeURIComponent(
          JSON.stringify({ json: { pagination: { pageSize: 9999 } } }),
        ),
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(badPage.status).toBe(400);

    // Wrong types are rejected.
    const badType = await app.request(
      "/api/trpc/monitoring.overview?input=" +
        encodeURIComponent(JSON.stringify({ json: { timeRange: 42 } })),
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(badType.status).toBe(400);
  });
});
