import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  isTransientError,
  retrySettings,
} from "./migrate-helpers";

describe("isTransientError", () => {
  it("classifies connection-level failures as transient", () => {
    expect(isTransientError(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4000"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("getaddrinfo ENOTFOUND gateway01.tidbcloud.com"), { code: "ENOTFOUND" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("EAI_AGAIN"), { code: "EAI_AGAIN" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("lose connection"), { code: "PROTOCOL_CONNECTION_LOST" }))).toBe(true);
  });

  it("classifies MySQL connection-number errors as transient", () => {
    expect(isTransientError(Object.assign(new Error("Too many connections"), { code: "ER_CON_COUNT_ERROR" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("1040"), { code: "1040" }))).toBe(true);
  });

  it("never retries deterministic failures", () => {
    expect(isTransientError(Object.assign(new Error("Access denied for user"), { code: "ER_ACCESS_DENIED_ERROR" }))).toBe(false);
    expect(isTransientError(Object.assign(new Error("Unknown database 'nope'"), { code: "ER_BAD_DB_ERROR" }))).toBe(false);
    expect(isTransientError(Object.assign(new Error("SQL syntax"), { code: "ER_PARSE_ERROR" }))).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError("just a string")).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially and is bounded by maxMs", () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffDelayMs(0, 2000, 30000)).toBeLessThan(2000);
      expect(backoffDelayMs(4, 2000, 30000)).toBeLessThan(32000);
      expect(backoffDelayMs(20, 2000, 30000)).toBeLessThanOrEqual(30000);
    }
  });

  it("never returns negative", () => {
    expect(backoffDelayMs(0, 100, 100)).toBeGreaterThanOrEqual(0);
  });
});

describe("retrySettings", () => {
  it("applies defaults", () => {
    expect(retrySettings({})).toEqual({ maxRetries: 8, baseDelayMs: 2000, maxDelayMs: 30000 });
  });

  it("honours env overrides and clamps nonsense values", () => {
    expect(
      retrySettings({ MIGRATE_MAX_RETRIES: "3", MIGRATE_BASE_DELAY_MS: "500", MIGRATE_MAX_DELAY_MS: "5000" }),
    ).toEqual({ maxRetries: 3, baseDelayMs: 500, maxDelayMs: 5000 });

    const bad = retrySettings({ MIGRATE_MAX_RETRIES: "-2", MIGRATE_BASE_DELAY_MS: "10", MIGRATE_MAX_DELAY_MS: "1" });
    expect(bad.maxRetries).toBe(0);
    expect(bad.baseDelayMs).toBeGreaterThanOrEqual(100);
    expect(bad.maxDelayMs).toBeGreaterThanOrEqual(bad.baseDelayMs);
  });
});
