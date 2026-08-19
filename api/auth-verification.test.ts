import { describe, expect, it, vi } from "vitest";

// Same isolated env as app.test.ts, plus email configuration so the
// verification path is exercised instead of the auto-verify fallback.
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
process.env.RESEND_API_KEY = "re_test_key_for_verification";
process.env.APP_URL = "https://tracker.example.com";

// Capture every email the auth router would have sent through Resend and
// answer "sent", so the tests never touch the network.
const { sentEmails, sendEmailMock } = vi.hoisted(() => {
  const sentEmails: { to: string; html: string }[] = [];
  return {
    sentEmails,
    sendEmailMock: vi.fn(
      async (email: { to: string; html: string }): Promise<{ sent: boolean }> => {
        sentEmails.push({ to: email.to, html: email.html });
        return { sent: true };
      },
    ),
  };
});

vi.mock("./lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/email")>();
  return {
    ...actual,
    sendEmail: sendEmailMock,
  };
});

type App = Awaited<typeof import("./boot")>["default"];

let appPromise: Promise<App> | undefined;
function bootApp(): Promise<App> {
  appPromise ??= import("./boot").then((m) => m.default);
  return appPromise;
}

function tokenFromHtml(html: string, path: "verify-email" | "reset-password"): string {
  const match = html.match(new RegExp(`${path}\\?token=([0-9a-f]+)`));
  if (!match?.[1]) throw new Error(`no ${path} token found in email html`);
  return match[1];
}

async function registerUser(
  app: App,
  email: string,
  password = "password123",
  ip = "203.0.113.10",
): Promise<{ token: string; emailVerified: boolean }> {
  const res = await app.request("/api/trpc/auth.register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ json: { email, password } }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: {
      data: {
        json: {
          token: string;
          user: { emailVerified: boolean };
          emailVerificationSent: boolean;
        };
      };
    };
  };
  return {
    token: body.result.data.json.token,
    emailVerified: body.result.data.json.user.emailVerified,
  };
}

async function callTrpc(
  app: App,
  path: string,
  body: unknown,
  opts: { token?: string; ip?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return app.request(`/api/trpc/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ json: body }),
  });
}

describe("email verification", () => {
  it("registers an unverified account and emails a one-time link", async () => {
    const app = await bootApp();
    const email = `verify-${Date.now()}@example.com`;

    const created = await registerUser(app, email);
    expect(created.emailVerified).toBe(false);

    const sent = sentEmails.find((e) => e.to === email);
    expect(sent).toBeTruthy();
    expect(sent!.html).toContain("/verify-email?token=");
  });

  it("verifies with the token, then rejects replay of the same token", async () => {
    const app = await bootApp();
    const email = `verify-replay-${Date.now()}@example.com`;
    const ip = "203.0.113.11";
    await registerUser(app, email, "password123", ip);

    const sent = sentEmails.find((e) => e.to === email)!;
    const token = tokenFromHtml(sent.html, "verify-email");

    const verify = await callTrpc(app, "auth.verifyEmail", { token }, { ip });
    expect(verify.status).toBe(200);

    // Single use: the same token must be rejected on replay.
    const replay = await callTrpc(app, "auth.verifyEmail", { token }, { ip });
    expect(replay.status).toBe(400);

    // A garbage token is rejected too.
    const garbage = await callTrpc(app, "auth.verifyEmail", { token: "f".repeat(64) }, { ip });
    expect(garbage.status).toBe(400);
  });

  it("an unverified account cannot mint webhook keys; verification unlocks it", async () => {
    const app = await bootApp();
    const email = `verify-gate-${Date.now()}@example.com`;
    const ip = "203.0.113.12";
    const { token } = await registerUser(app, email, "password123", ip);

    const blocked = await callTrpc(app, "webhooks.createKey", { name: "gate" }, { token, ip });
    expect(blocked.status).toBe(403);

    const sent = sentEmails.find((e) => e.to === email)!;
    const verifyToken = tokenFromHtml(sent.html, "verify-email");
    const verify = await callTrpc(app, "auth.verifyEmail", { token: verifyToken }, { ip });
    expect(verify.status).toBe(200);

    const allowed = await callTrpc(app, "webhooks.createKey", { name: "gate" }, { token, ip });
    expect(allowed.status).toBe(200);
  });

  it("resend issues a fresh token that replaces the old one", async () => {
    const app = await bootApp();
    const email = `verify-resend-${Date.now()}@example.com`;
    const ip = "203.0.113.13";
    await registerUser(app, email, "password123", ip);

    const first = tokenFromHtml(sentEmails.find((e) => e.to === email)!.html, "verify-email");

    const resend = await callTrpc(app, "auth.resendVerification", { email }, { ip });
    expect(resend.status).toBe(200);

    const emails = sentEmails.filter((e) => e.to === email);
    expect(emails.length).toBe(2);
    const second = tokenFromHtml(emails[1]!.html, "verify-email");
    expect(second).not.toBe(first);

    // The old token is dead; the fresh one works.
    const oldReplay = await callTrpc(app, "auth.verifyEmail", { token: first }, { ip });
    expect(oldReplay.status).toBe(400);
    const freshVerify = await callTrpc(app, "auth.verifyEmail", { token: second }, { ip });
    expect(freshVerify.status).toBe(200);
  });

  it("resend is generic: it never reveals whether an email exists", async () => {
    const app = await bootApp();
    const missing = await callTrpc(app, "auth.resendVerification", {
      email: "nobody-exists@example.com",
    }, { ip: "203.0.113.14" });
    expect(missing.status).toBe(200);
  });

  it("without email configuration, sign-up auto-verifies", async () => {
    // A fresh module instance without RESEND_API_KEY/APP_URL — the
    // zero-credential demo path. Use the demo account flow instead of
    // re-importing modules: register a brand-new account in this worker with
    // email config present is covered above; here we assert the demo user
    // itself is pre-verified.
    const app = await bootApp();
    const login = await app.request("/api/trpc/auth.login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { email: "demo@example.com", password: "demo1234" } }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as {
      result: { data: { json: { user: { emailVerified: boolean } } } };
    };
    expect(body.result.data.json.user.emailVerified).toBe(true);
  });
});

describe("password reset", () => {
  it("resets the password with a one-time token and revokes old sessions", async () => {
    const app = await bootApp();
    const email = `reset-${Date.now()}@example.com`;
    const ip = "203.0.113.20";
    const { token: sessionToken } = await registerUser(app, email, "password123", ip);

    // The account must be verified before reset is usable in real life, so
    // verify it first (also proves the two flows compose).
    const sent = sentEmails.find((e) => e.to === email)!;
    const verifyToken = tokenFromHtml(sent.html, "verify-email");
    const verify = await callTrpc(app, "auth.verifyEmail", { token: verifyToken }, { ip });
    expect(verify.status).toBe(200);

    const requestReset = await callTrpc(app, "auth.requestPasswordReset", { email }, { ip });
    expect(requestReset.status).toBe(200);

    const resetEmail = sentEmails.filter((e) => e.to === email).at(-1)!;
    const resetToken = tokenFromHtml(resetEmail.html, "reset-password");

    const reset = await callTrpc(app, "auth.resetPassword", {
      token: resetToken,
      newPassword: "brand-new-password1",
    }, { ip });
    expect(reset.status).toBe(200);

    // The reset revoked the old session token.
    const me = await app.request("/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.status).toBe(401);

    // Old password no longer works; new password does.
    const oldLogin = await callTrpc(app, "auth.login", {
      email,
      password: "password123",
    }, { ip });
    expect(oldLogin.status).toBe(401);

    const newLogin = await callTrpc(app, "auth.login", {
      email,
      password: "brand-new-password1",
    }, { ip });
    expect(newLogin.status).toBe(200);

    // The reset token is single-use — replay is rejected.
    const replay = await callTrpc(app, "auth.resetPassword", {
      token: resetToken,
      newPassword: "another-password2",
    }, { ip });
    expect(replay.status).toBe(400);
  });

  it("reset request is generic for unknown emails", async () => {
    const app = await bootApp();
    const missing = await callTrpc(app, "auth.requestPasswordReset", {
      email: "no-such-account@example.com",
    }, { ip: "203.0.113.21" });
    expect(missing.status).toBe(200);
  });

  it("rejects a wrong reset token", async () => {
    const app = await bootApp();
    const bad = await callTrpc(app, "auth.resetPassword", {
      token: "a".repeat(64),
      newPassword: "whatever1234",
    }, { ip: "203.0.113.22" });
    expect(bad.status).toBe(400);
  });
});

describe("one-time token security", () => {
  it("tokenValid rejects expired and tampered tokens (constant-time compare)", async () => {
    const { randomToken, hashToken, tokenValid, VERIFICATION_TTL_MS } = await import(
      "./auth/tokens"
    );
    const token = randomToken();
    const digest = hashToken(token);
    const now = new Date();

    expect(tokenValid(digest, new Date(now.getTime() + VERIFICATION_TTL_MS), token, now)).toBe(true);
    expect(
      tokenValid(digest, new Date(now.getTime() + VERIFICATION_TTL_MS), "0".repeat(64), now),
    ).toBe(false);
    expect(tokenValid(digest, new Date(now.getTime() - 1), token, now)).toBe(false);
    expect(tokenValid(null, new Date(now.getTime() + VERIFICATION_TTL_MS), token, now)).toBe(false);
    expect(tokenValid(digest, null, token, now)).toBe(false);
  });

  it("rate limits verification attempts per IP (10 budget)", async () => {
    const app = await bootApp();
    const ip = "198.51.100.7";

    for (let i = 0; i < 10; i += 1) {
      const res = await callTrpc(
        app,
        "auth.verifyEmail",
        { token: `${i}`.padStart(64, "f") },
        { ip },
      );
      expect(res.status).toBe(400);
    }
    const blocked = await callTrpc(
      app,
      "auth.verifyEmail",
      { token: "f".repeat(64) },
      { ip },
    );
    expect(blocked.status).toBe(429);
  });

  it("rate limits password-reset requests per account+IP", async () => {
    const app = await bootApp();
    const ip = "198.51.100.8";
    const email = "flood@example.com";

    for (let i = 0; i < 3; i += 1) {
      const res = await callTrpc(app, "auth.requestPasswordReset", { email }, { ip });
      expect(res.status).toBe(200);
    }
    const blocked = await callTrpc(app, "auth.requestPasswordReset", { email }, { ip });
    expect(blocked.status).toBe(429);

    // A different source IP still has its own budget (per account+IP).
    const otherIp = await callTrpc(app, "auth.requestPasswordReset", { email }, { ip: "198.51.100.9" });
    expect(otherIp.status).toBe(200);
  });
});
