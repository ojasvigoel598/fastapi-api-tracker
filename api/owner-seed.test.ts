import { describe, expect, it } from "vitest";

// Force demo mode with a configured owner account.
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
process.env.RESEND_FROM = "";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.OWNER_PASSWORD = "owner-pass-123";

type Caller = ReturnType<
  Awaited<typeof import("./router")>["appRouter"]["createCaller"]
>;

async function anonymousCaller(token?: string): Promise<Caller> {
  const { appRouter } = await import("./router");
  const { authenticateRequest } = await import("./context");
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const user = await authenticateRequest(headers);
  return appRouter.createCaller({
    req: new Request("http://localhost/api/trpc", { headers }),
    resHeaders: new Headers(),
    user,
  });
}

describe("owner account seeding", () => {
  it("seeds the configured owner as an admin who can sign in", async () => {
    const caller = await anonymousCaller();

    const login = await caller.auth.login({
      email: "owner@example.com",
      password: "owner-pass-123",
    });
    expect(login.user.email).toBe("owner@example.com");
    expect(login.user.role).toBe("admin");
    expect(login.token).toBeTruthy();

    // The owner has their own seeded dataset, not an empty dashboard.
    const authed = await anonymousCaller(login.token);
    const overview = await authed.monitoring.overview({ timeRange: "24h" });
    expect(overview.totalRequests).toBeGreaterThan(0);
  });

  it("rejects a wrong password for the owner", async () => {
    const caller = await anonymousCaller();
    await expect(
      caller.auth.login({
        email: "owner@example.com",
        password: "definitely-wrong",
      }),
    ).rejects.toThrow(/Invalid email or password/);
  });
});
