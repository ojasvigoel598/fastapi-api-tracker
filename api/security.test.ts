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
