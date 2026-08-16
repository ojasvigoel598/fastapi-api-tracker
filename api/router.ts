import { authRouter } from "./auth-router";
import { monitoringRouter } from "./monitoring-router";
import { seedRouter } from "./seed-router";
import { kimiRouter } from "./kimi-router";
import { limitsRouter } from "./limits-router";
import { webhooksRouter } from "./webhooks-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  monitoring: monitoringRouter,
  seed: seedRouter,
  kimi: kimiRouter,
  limits: limitsRouter,
  webhooks: webhooksRouter,
});

export type AppRouter = typeof appRouter;
