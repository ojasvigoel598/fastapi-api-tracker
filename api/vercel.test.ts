import { describe, expect, it } from "vitest";
import { reconstructUrl } from "./vercel";

describe("vercel path reconstruction", () => {
  it("restores the original path when Vercel rewrites to /api?vercelPath=...", () => {
    const url = reconstructUrl("http://localhost/api?vercelPath=/trpc/auth.me");
    expect(url.pathname).toBe("/api/trpc/auth.me");
    expect(url.searchParams.has("vercelPath")).toBe(false);
  });

  it("handles a rewritten root /api request", () => {
    const url = reconstructUrl("http://localhost/api?vercelPath=");
    expect(url.pathname).toBe("/api");
  });

  it("leaves a preserved original path alone even when the param is present", () => {
    const url = reconstructUrl("http://localhost/api/health?vercelPath=/health");
    expect(url.pathname).toBe("/api/health");
    expect(url.searchParams.has("vercelPath")).toBe(false);
  });

  it("keeps unrelated query parameters when reconstructing", () => {
    const url = reconstructUrl(
      "http://localhost/api?vercelPath=/trpc/foo&batch=1",
    );
    expect(url.pathname).toBe("/api/trpc/foo");
    expect(url.searchParams.get("batch")).toBe("1");
  });

  it("is a no-op without the vercelPath param", () => {
    const url = reconstructUrl("http://localhost/api/health?x=1");
    expect(url.pathname).toBe("/api/health");
    expect(url.searchParams.get("x")).toBe("1");
  });
});
