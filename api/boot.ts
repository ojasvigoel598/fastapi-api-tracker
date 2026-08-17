import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { handleIngest, handleCheckLimit } from "./ingest";
import { handleWebhookIngest, handleWebhookReplay } from "./webhook";

if (env.isDemoMode) {
  console.warn(
    "[demo] DEMO MODE — DATABASE_URL is not configured. " +
      "Serving seeded in-memory data with local email/password accounts. " +
      "Configure DATABASE_URL (and optionally Supabase) for production.",
  );
}

const app = new Hono<{ Bindings: HttpBindings }>();

/**
 * Reject oversized request bodies without touching the body stream.
 *
 * Hono's `bodyLimit` middleware reconstructs the request with
 * `new Request(c.req.raw, ...)` for chunked / no-content-length bodies,
 * which crashes on Node 24 (`Cannot read private member #state`) and turns
 * any bodyless POST (e.g. `auth.logout`) into a 500. This header-based
 * guard keeps the 50 MB cap for the common case while never consuming or
 * rebuilding the stream.
 */
const MAX_BODY_BYTES = 50 * 1024 * 1024;
app.use(async (c, next) => {
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return c.json({ error: "Payload Too Large" }, 413);
  }
  return next();
});

app.post("/api/ingest", (c) => handleIngest(c.req.raw));
app.get("/api/check-limit", (c) => handleCheckLimit(c.req.raw));

/**
 * Real-time telemetry webhook — key-authenticated, no session required.
 * Accepts a single event or a batch; see api/webhook.ts for the contract.
 */
app.post("/api/webhook/ingest", (c) => handleWebhookIngest(c.req.raw));

/**
 * Re-fire a stored webhook delivery — key-authenticated, same contract as
 * ingest. See api/webhook.ts for the shape of the response.
 */
app.post("/api/webhook/replay/:id", (c) => handleWebhookReplay(c.req.raw));

/**
 * Readiness probe — no auth, no database, no external calls.
 * Kept cheap and stable so the preview proxy and the browser can detect a
 * live backend immediately after a sandbox recycle (which may hand the app
 * a new container IP).
 */
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    mode: env.isDemoMode ? "demo" : env.isProduction ? "production" : "development",
    time: Date.now(),
  }),
);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

// Run a long-lived Node server locally (and in Docker). On Vercel the app is
// served as a serverless function (api/vercel.ts) — Vercel sets `VERCEL` and
// serves static assets from its CDN, so skip both `serve()` and static file
// mounting there.
if (env.isProduction && !process.env.VERCEL) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
