import { describe, expect, it } from "vitest";

// Force the offline demo store so the suite is deterministic and never
// touches developer credentials or a real database.
process.env.NODE_ENV = "test";
process.env.DEMO_MODE = "true";
process.env.DATABASE_URL = "";
process.env.APP_SECRET = "unit-test-secret-key-that-is-long-enough-for-hs256";
process.env.CLERK_SECRET_KEY = "";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.SUPABASE_JWT_SECRET = "";
process.env.KIMI_OPEN_URL = "";
process.env.KIMI_API_KEY = "";
process.env.RESEND_API_KEY = "";

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
  const email = `fail-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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
  statusCode: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { handleIngest } = await import("./ingest");
  const response = await handleIngest(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      body: JSON.stringify({
        endpoint,
        method,
        statusCode,
        latencyMs: 25,
        errorMessage: statusCode >= 400 ? `Controlled failure ${statusCode}` : undefined,
      }),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("failure history & request detail", () => {
  it("returns only failed requests, most recent first, with a 30 default", async () => {
    const { caller, cookieHeader } = await authedSession();
    const endpoint = `/failures-${Date.now()}`;

    await ingest(cookieHeader, endpoint, "GET", 200);
    await ingest(cookieHeader, endpoint, "GET", 500);
    await ingest(cookieHeader, endpoint, "GET", 404);

    const result = await caller.monitoring.failures({ page: 1, pageSize: 30 });

    // Includes seeded failures plus our two, but never a success row.
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.items.length).toBeLessThanOrEqual(30);
    for (const item of result.items) {
      expect(item.statusCode).toBeGreaterThanOrEqual(400);
    }

    // Our controlled failures are the newest, so they lead the list.
    expect(result.items[0]?.endpoint).toBe(endpoint);
    expect(result.items[0]?.errorMessage).toContain("Controlled failure");
  });

  it("exposes the full diagnostic record through requestDetail", async () => {
    const { caller, cookieHeader } = await authedSession();
    const endpoint = `/detail-${Date.now()}`;

    const res = await ingest(cookieHeader, endpoint, "GET", 503);
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    expect(id).toBeGreaterThan(0);

    const detail = await caller.monitoring.requestDetail({ id });
    expect(detail?.endpoint).toBe(endpoint);
    expect(detail?.method).toBe("GET");
    expect(detail?.statusCode).toBe(503);
    expect(detail?.latencyMs).toBe(25);
    expect(detail?.errorMessage).toContain("Controlled failure");
  });

  it("does not leak request details across users", async () => {
    const a = await authedSession();
    const b = await authedSession();
    const endpoint = `/private-${Date.now()}`;

    const res = await ingest(a.cookieHeader, endpoint, "GET", 500);
    const id = res.body.id as number;

    const aDetail = await a.caller.monitoring.requestDetail({ id });
    expect(aDetail?.endpoint).toBe(endpoint);

    const bDetail = await b.caller.monitoring.requestDetail({ id });
    expect(bDetail).toBeUndefined();
  });
});
