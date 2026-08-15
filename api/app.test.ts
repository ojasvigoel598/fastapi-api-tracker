import { describe, expect, it } from "vitest";

// Keep the offline suite deterministic even when a developer has local
// Clerk, Supabase, database, or Kimi credentials in an ignored .env file.
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

async function newSession(): Promise<{
  caller: Caller;
  reload: () => Promise<Caller>;
  resHeaders: Headers;
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

  const caller = await build();

  async function reload(): Promise<Caller> {
    const setCookie = resHeaders.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/app_sid=([^;]*)/);
      if (m) cookieHeader = m[1] ? `app_sid=${m[1]}` : "";
    }
    return build();
  }

  return { caller, reload, resHeaders };
}

describe("app router", () => {
  it("ping responds without auth or database", async () => {
    const { caller } = await newSession();
    const result = await caller.ping();
    expect(result.ok).toBe(true);
    expect(typeof result.ts).toBe("number");
  });

  it("serves an unauthenticated health endpoint", async () => {
    const { default: app } = await import("./boot");
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode: string };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("demo");
  });

  it("config reports local mode in demo (no Supabase)", async () => {
    const { caller } = await newSession();
    const config = await caller.auth.config();
    expect(config.mode).toBe("local");
    expect(config.demoCredentials?.email).toBe("demo@example.com");
    expect(config.kimiStatus).toBe("mock");
  });

  it("signs and verifies an application session token", async () => {
    const { signSessionToken, verifySessionToken } = await import(
      "./auth/session"
    );
    const token = await signSessionToken({ userId: 7, email: "a@b.co" });
    expect(await verifySessionToken(token)).toEqual({
      userId: 7,
      email: "a@b.co",
    });
    expect(await verifySessionToken("garbage")).toBeNull();
  });

  it("scopes the session cookie to the request context", async () => {
    const { getSessionCookieOptions } = await import("./lib/cookies");

    // Same-origin / top-level tab access (the common localhost + preview tab
    // case) must be a plain first-party cookie.
    const sameOrigin = getSessionCookieOptions(
      new Headers({
        host: "app.daytonaproxy01.net",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(sameOrigin.sameSite).toBe("Lax");
    expect(sameOrigin.secure).toBe(true);

    // A genuine cross-site iframe (the hosted preview pane) requires
    // SameSite=None so the cookie is sent on the cross-site fetch, but it must
    // NOT be Partitioned — a partitioned cookie vanishes when the app is
    // opened in its own tab, which reproduces the sign-in loop.
    const crossSite = getSessionCookieOptions(
      new Headers({
        host: "app.daytonaproxy01.net",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(crossSite.sameSite).toBe("None");
    expect(crossSite.secure).toBe(true);

    // Plain localhost dev over HTTP must not mark the cookie Secure.
    const localhost = getSessionCookieOptions(
      new Headers({ host: "localhost:3000" }),
    );
    expect(localhost.sameSite).toBe("Lax");
    expect(localhost.secure).toBe(false);

    // A non-localhost host served over plain HTTP (no forwarded-proto) must
    // NOT be marked Secure — a Secure cookie over HTTP is silently dropped by
    // browsers, which is what previously caused the preview sign-in loop.
    const plainHttp = getSessionCookieOptions(
      new Headers({ host: "preview.internal:3000" }),
    );
    expect(plainHttp.sameSite).toBe("Lax");
    expect(plainHttp.secure).toBe(false);
  });

  it("hashes and verifies passwords", async () => {
    const { hashPassword, verifyPassword } = await import("./auth/password");
    const { salt, hash } = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", salt, hash)).toBe(true);
    expect(verifyPassword("wrong", salt, hash)).toBe(false);
  });

  it("registers, signs in, and exposes the session", async () => {
    const s = await newSession();

    const signup = await s.caller.auth.register({
      email: "auth@example.com",
      password: "password123",
      name: "Alice",
    });
    expect(signup.user.email).toBe("auth@example.com");
    expect(signup.token).toBeTruthy();
    expect((signup.user as Record<string, unknown>).passwordHash).toBeUndefined();

    // The session cookie is now persisted on the session.
    const authed = await s.reload();
    const me = await authed.auth.me();
    expect(me.email).toBe("auth@example.com");

    // Logout clears the cookie.
    await authed.auth.logout();
    const loggedOut = await s.reload();
    await expect(loggedOut.auth.me()).rejects.toThrow(/Authentication required/);

    // Sign back in with the same credentials.
    const relogin = await newSession();
    const login = await relogin.caller.auth.login({
      email: "auth@example.com",
      password: "password123",
    });
    expect(login.user.email).toBe("auth@example.com");
    expect(login.token).toBeTruthy();
  });

  it("rejects invalid credentials and duplicate emails", async () => {
    const s = await newSession();

    await expect(
      s.caller.auth.login({ email: "nobody@example.com", password: "nope1234" }),
    ).rejects.toThrow(/Invalid email or password/);

    await s.caller.auth.register({
      email: "dup@example.com",
      password: "password123",
    });
    await expect(
      s.caller.auth.register({
        email: "dup@example.com",
        password: "password456",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("isolates monitoring data between two users", async () => {
    const alice = await newSession();
    const bob = await newSession();

    await alice.caller.auth.register({
      email: "alice@example.com",
      password: "password123",
    });
    await bob.caller.auth.register({
      email: "bob@example.com",
      password: "password123",
    });

    const aliceAuthed = await alice.reload();
    const bobAuthed = await bob.reload();

    const aliceOverview = await aliceAuthed.monitoring.overview({
      timeRange: "24h",
    });
    const bobOverview = await bobAuthed.monitoring.overview({
      timeRange: "24h",
    });
    expect(aliceOverview.totalRequests).toBeGreaterThan(0);
    expect(bobOverview.totalRequests).toBeGreaterThan(0);

    // Alice creates a uniquely-named request and a private alert.
    await aliceAuthed.monitoring.createLog({
      endpoint: "/alice-only-endpoint",
      method: "GET",
      statusCode: 200,
      latencyMs: 5,
    });
    await aliceAuthed.monitoring.createAlert({
      type: "endpoint_down",
      severity: "critical",
      endpoint: "/alice-only-endpoint",
      message: "Alice's private alert",
    });

    const aliceLogs = await aliceAuthed.monitoring.requests({
      filters: { endpoint: "/alice-only-endpoint" },
    });
    expect(aliceLogs.total).toBe(1);

    // Bob must not see Alice's request or alert.
    const bobLogs = await bobAuthed.monitoring.requests({
      filters: { endpoint: "/alice-only-endpoint" },
    });
    expect(bobLogs.total).toBe(0);

    const bobAlerts = await bobAuthed.monitoring.alerts({});
    expect(bobAlerts.some((a) => a.message === "Alice's private alert")).toBe(
      false,
    );
  });

  it("requires authentication for monitoring routes", async () => {
    const { caller } = await newSession();
    await expect(
      caller.monitoring.overview({ timeRange: "24h" }),
    ).rejects.toThrow(/Authentication required/);
  });

  it("records HTTP telemetry through ingestion and applies a custom date range", async () => {
    const { handleIngest } = await import("./ingest");
    const s = await newSession();
    await s.caller.auth.register({
      email: "ingest@example.com",
      password: "password123",
    });
    const setCookie = s.resHeaders.get("set-cookie");
    const authed = await s.reload();
    expect(setCookie).toContain("app_sid=");
    const cookieHeader = setCookie?.match(/app_sid=([^;]*)/)?.[1];
    expect(cookieHeader).toBeTruthy();

    const response = await handleIngest(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: {
          cookie: `app_sid=${cookieHeader}`,
          "content-type": "application/json",
          "user-agent": "controlled-test-client",
        },
        body: JSON.stringify({
          endpoint: "/controlled-get",
          method: "get",
          statusCode: 201,
          latencyMs: 42,
          responseSize: 128,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const ingestBody = (await response.json()) as { ok?: boolean };
    expect(ingestBody.ok).toBe(true);

    const startDate = new Date(Date.now() - 60_000).toISOString();
    const endDate = new Date(Date.now() + 60_000).toISOString();
    const result = await authed.monitoring.requests({
      filters: {
        endpoint: "/controlled-get",
        timeRange: "custom",
        startDate,
        endDate,
      },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.statusCode).toBe(201);
    expect(result.items[0]?.latencyMs).toBe(42);

    const unauthenticated = await handleIngest(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        body: JSON.stringify({ endpoint: "/nope", method: "GET", statusCode: 200, latencyMs: 1 }),
      }),
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("serves a deterministic mock Kimi analysis in demo mode", async () => {
    const s = await newSession();
    await s.caller.auth.register({
      email: "kimi@example.com",
      password: "password123",
    });
    const authed = await s.reload();

    const status = await authed.kimi.status();
    expect(status.state).toBe("mock");

    const analysis = await authed.kimi.analyze();
    expect(analysis.state).toBe("mock");
    expect(analysis.analysis).toContain("API monitoring data");
  });

  it("authenticates via the bearer session token when no cookie is present", async () => {
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
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    // No cookie — only the bearer token. This is the path the client takes
    // when a hosted preview proxy strips or rewrites the Set-Cookie header.
    const meRes = await app.request("/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as {
      result: { data: { json: { email: string } } };
    };
    expect(meBody.result.data.json.email).toBe("demo@example.com");

    // A garbage bearer token must not authenticate.
    const badRes = await app.request("/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(badRes.status).toBe(401);
  });
});
