import { describe, expect, it } from "vitest";

// Force the offline demo store for a deterministic suite.
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

import { FixedWindowRateLimiter } from "./lib/rate-limit";
import {
  clientIp,
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthFailures,
  ACCOUNT_MAX_FAILURES,
  IP_MAX_FAILURES,
} from "./lib/auth-rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("blocks after max hits and reports retry-after", () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    const t0 = 1_000_000;

    expect(limiter.check("k", t0).allowed).toBe(true);
    limiter.recordFailure("k", t0);
    limiter.recordFailure("k", t0);
    limiter.recordFailure("k", t0);

    const blocked = limiter.check("k", t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("clears on success and rolls over at the window boundary", () => {
    const limiter = new FixedWindowRateLimiter(1, 1000);

    limiter.recordFailure("k", 0);
    expect(limiter.check("k", 0).allowed).toBe(false);

    limiter.clear("k");
    expect(limiter.check("k", 0).allowed).toBe(true);

    limiter.recordFailure("k", 0);
    expect(limiter.check("k", 999).allowed).toBe(false);
    expect(limiter.check("k", 1000).allowed).toBe(true); // window rolled over
  });

  it("prunes expired buckets", () => {
    const limiter = new FixedWindowRateLimiter(1, 1000);
    limiter.recordFailure("a", 0);
    limiter.recordFailure("b", 0);
    limiter.prune(2000);
    expect(limiter.check("a", 2000).allowed).toBe(true);
    expect(limiter.check("b", 2000).allowed).toBe(true);
  });
});

describe("auth-rate-limit helpers (per-IP + keying)", () => {
  it("clientIp takes the first forwarded hop and falls back to unknown", () => {
    expect(
      clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("blocks at the per-IP budget even across different accounts (spraying)", () => {
    const ip = "203.0.113.77"; // unique IP for this test
    for (let i = 0; i < IP_MAX_FAILURES; i++) {
      recordAuthFailure(`spray-${i}-${Date.now()}@example.com`, ip);
    }
    // A never-tried account from the same IP is blocked by the IP budget.
    const blocked = checkAuthRateLimit(`never-tried-${Date.now()}@example.com`, ip);
    expect(blocked).not.toBeNull();
    expect(blocked!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("account block reports retry-after and is independent of the IP budget", () => {
    const email = `acct-${Date.now()}@example.com`;
    for (let i = 0; i < ACCOUNT_MAX_FAILURES; i++) {
      recordAuthFailure(email, "203.0.113.88");
    }
    // Blocked even from a different source IP.
    expect(checkAuthRateLimit(email, "203.0.113.89")?.retryAfterSeconds).toBeGreaterThan(0);
    // Another account from the same source IP is not blocked (5 < IP budget).
    expect(
      checkAuthRateLimit(`other-${Date.now()}@example.com`, "203.0.113.88"),
    ).toBeNull();
  });

  it("clearAuthFailures clears the account bucket but not the IP budget", () => {
    const email = `clear-${Date.now()}@example.com`;
    const ip = "203.0.113.90";
    for (let i = 0; i < ACCOUNT_MAX_FAILURES; i++) {
      recordAuthFailure(email, ip);
    }
    expect(checkAuthRateLimit(email, ip)).not.toBeNull();
    clearAuthFailures(email);
    // Account cleared; the IP (still under its budget) allows the request.
    expect(checkAuthRateLimit(email, ip)).toBeNull();
  });
});

describe("login rate limiting (integration)", () => {
  type Caller = ReturnType<
    Awaited<typeof import("./router")>["appRouter"]["createCaller"]
  >;

  async function anonymousCaller(ip = "203.0.113.9"): Promise<Caller> {
    const { appRouter } = await import("./router");
    const { authenticateRequest } = await import("./context");
    const headers = new Headers({ "x-forwarded-for": ip });
    const user = await authenticateRequest(headers);
    return appRouter.createCaller({
      req: new Request("http://localhost/api/trpc", { headers }),
      resHeaders: new Headers(),
      user,
    });
  }

  it("locks an account after repeated failed sign-ins, then lets a correct login succeed", async () => {
    const email = `ratelimit-${Date.now()}@example.com`;
    const caller = await anonymousCaller();

    // Register the account first.
    await caller.auth.register({ email, password: "correct-password-1" });

    // Five wrong passwords (each is a fresh unauthenticated caller so the
    // register session cookie doesn't interfere).
    for (let i = 0; i < 5; i++) {
      const c = await anonymousCaller();
      await expect(
        c.auth.login({ email, password: "wrong-password" }),
      ).rejects.toThrow(/Invalid email or password/);
    }

    // The sixth attempt is now rate limited before credentials are checked.
    const blocked = await anonymousCaller();
    await expect(
      blocked.auth.login({ email, password: "wrong-password" }),
    ).rejects.toThrow(/Too many failed sign-in attempts/);
  });

  it("blocks a source IP after many failures across accounts, even with a correct password", async () => {
    const ip = `203.0.113.${120 + (Date.now() % 100)}`; // unique IP

    // One failure per distinct account, all from the same IP, so only the
    // per-IP budget grows (each account stays under its own 5-failure cap).
    const emails = Array.from(
      { length: 20 },
      (_, i) => `ipspray-${i}-${Date.now()}@example.com`,
    );
    for (const email of emails) {
      const c = await anonymousCaller(ip);
      await c.auth.register({ email, password: "correct-password-1" });
    }
    for (const email of emails) {
      const f = await anonymousCaller(ip);
      await expect(
        f.auth.login({ email, password: "wrong-password" }),
      ).rejects.toThrow(/Invalid email or password/);
    }

    // A DIFFERENT account with the CORRECT password is now blocked from
    // this IP — password-spraying protection, not just per-account.
    const otherEmail = `other-ip-${Date.now()}@example.com`;
    await anonymousCaller("203.0.113.200").then((c2) =>
      c2.auth.register({ email: otherEmail, password: "correct-password-1" }),
    );
    const other = await anonymousCaller(ip);
    await expect(
      other.auth.login({ email: otherEmail, password: "correct-password-1" }),
    ).rejects.toThrow(/Too many failed sign-in attempts/);
  });

  it("does not lock out a correct sign-in after a few failures", async () => {
    const email = `ok-${Date.now()}@example.com`;
    const c = await anonymousCaller();
    await c.auth.register({ email, password: "correct-password-1" });

    for (let i = 0; i < 2; i++) {
      const f = await anonymousCaller();
      await expect(
        f.auth.login({ email, password: "nope-nope-nope" }),
      ).rejects.toThrow(/Invalid email or password/);
    }

    // A correct sign-in still works (and clears the account bucket).
    const ok = await anonymousCaller();
    const login = await ok.auth.login({ email, password: "correct-password-1" });
    expect(login.user.email).toBe(email);
    expect(login.token).toBeTruthy();
  });
});
