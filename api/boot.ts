import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { handleIngest, handleCheckLimit } from "./ingest";

if (env.isDemoMode) {
  console.warn(
    "[demo] LOCAL DEMO MODE — DATABASE_URL is not configured. " +
      "Serving seeded in-memory data with local email/password accounts. " +
      "Configure DATABASE_URL (and optionally Supabase) for production.",
  );
}

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

app.post("/api/ingest", (c) => handleIngest(c.req.raw));
app.get("/api/check-limit", (c) => handleCheckLimit(c.req.raw));

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

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
