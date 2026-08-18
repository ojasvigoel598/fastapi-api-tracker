/**
 * Ready-to-drop telemetry middleware for Express (and Node HTTP servers).
 *
 * Every request your API serves is pushed as one event to the
 * fastapi-api-tracker webhook, so the dashboard automatically shows
 * failure rate, latency percentiles, endpoints, and (optionally) cost —
 * no changes to your route handlers.
 *
 * Setup (2 steps):
 *
 * 1. Create an API key on the tracker's **Webhooks** page (starts with `apk_`).
 * 2. Add the middleware:
 *
 *    import express from "express";
 *    import { telemetryMiddleware } from "./telemetry.mjs";
 *
 *    const app = express();
 *    app.use(telemetryMiddleware());
 *
 * Security properties:
 * - The API key lives only in server-side env (`TRACKER_API_KEY`), never in
 *   code or logs, and is never sent to the browser.
 * - The event is dispatched AFTER the response finishes, so telemetry never
 *   blocks or slows your API.
 * - All errors inside telemetry are swallowed — a tracker outage can never
 *   break your API.
 * - Only an allowlisted subset of request headers is forwarded
 *   (never `Authorization`, cookies, or other credentials).
 * - The middleware never logs the event payload or the key.
 *
 * Configuration (env vars):
 * - TRACKER_URL        Base URL of the tracker, e.g. https://tracker.example.com
 *                       (or http://localhost:3000 locally). Required.
 * - TRACKER_API_KEY    The `apk_...` key created in the tracker's Webhooks
 *                       page. Required.
 * - TRACKER_TIMEOUT    Per-attempt HTTP timeout in ms. Default 2000.
 * - TRACKER_ENDPOINT   Tracker ingest path. Default /api/webhook/ingest.
 *
 * Optional extras:
 * - Pass `costCb(req, res) -> number | null` to report per-request cost
 *   (e.g. LLM token cost). The returned value is sent as the event's `cost`.
 * - Use `checkRateLimit()` (exported below) in a route or gateway to
 *   pre-flight the tracker's configured per-endpoint limits (advisory; the
 *   tracker enforces authoritatively on ingest).
 */

const TRACKER_URL = (process.env.TRACKER_URL ?? "").replace(/\/+$/, "");
const TRACKER_API_KEY = process.env.TRACKER_API_KEY ?? "";
const TRACKER_TIMEOUT = Number(process.env.TRACKER_TIMEOUT ?? "2000");
const TRACKER_ENDPOINT =
  process.env.TRACKER_ENDPOINT ?? "/api/webhook/ingest";

// Headers that are safe to forward to the tracker. Never send credentials.
const SAFE_HEADERS = new Set([
  "x-request-id",
  "content-type",
  "accept",
  "user-agent",
]);

function buildEvent(req, res, latencyMs, costCb) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (SAFE_HEADERS.has(name)) headers[name] = value;
  }

  const event = {
    endpoint: req.path || "/",
    method: (req.method ?? "GET").toUpperCase(),
    statusCode: res.statusCode,
    latencyMs,
    requestHeaders: headers,
  };
  if (res.statusCode >= 400) {
    // Generic, deterministic message — never echo internal details.
    event.errorMessage = "Request failed";
  }
  if (typeof costCb === "function") {
    try {
      const cost = costCb(req, res);
      if (cost != null && Number.isFinite(Number(cost))) event.cost = Number(cost);
    } catch {
      // cost reporting must never break telemetry
    }
  }
  return event;
}

async function sendEvent(event) {
  if (!TRACKER_URL || !TRACKER_API_KEY) return;
  const url = `${TRACKER_URL}${TRACKER_ENDPOINT}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACKER_TIMEOUT);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TRACKER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      // Drain the response so the socket can be reused.
      await res.arrayBuffer().catch(() => undefined);
      return;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 100));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function telemetryMiddleware({ costCb } = {}) {
  return function telemetry(req, res, next) {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const latencyMs = Math.round(
        Number(process.hrtime.bigint() - started) / 1e6,
      );
      try {
        const event = buildEvent(req, res, latencyMs, costCb);
        // Fire-and-forget: never await telemetry before responding.
        void sendEvent(event);
      } catch {
        // telemetry must never break the response
      }
    });
    next();
  };
}

export async function checkRateLimit(endpoint, method = "GET", timeout = 1500) {
  if (!TRACKER_URL || !TRACKER_API_KEY) {
    return { allowed: true, limited: false };
  }
  const url = `${TRACKER_URL}/api/check-limit?endpoint=${encodeURIComponent(
    endpoint,
  )}&method=${encodeURIComponent(method)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TRACKER_API_KEY}` },
      signal: controller.signal,
    });
    if (res.status === 200) return { allowed: true, ...(await res.json()) };
    if (res.status === 429) return { allowed: false, ...(await res.json()) };
    return { allowed: true, limited: false };
  } catch {
    // tracker outage must never block requests
    return { allowed: true, limited: false };
  } finally {
    clearTimeout(timer);
  }
}
