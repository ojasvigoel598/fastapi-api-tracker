import { authRouter } from "./auth-router";
import { monitoringRouter } from "./monitoring-router";
import { seedRouter } from "./seed-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  monitoring: monitoringRouter,
  seed: seedRouter,
});

export type AppRouter = typeof appRouter;
