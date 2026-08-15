/**
 * Usage Limits & Rate-Limiting tRPC Router.
 *
 * Every route is authenticated and scoped to the signed-in user.
 */

import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import {
  listUsageLimits,
  getUsageLimit,
  saveUsageLimit,
  deleteUsageLimit,
  listUsageAlerts,
} from "./queries/usage";

const configSchema = z.object({
  dailyLimit: z.number().int().min(0).nullable().optional(),
  monthlyLimit: z.number().int().min(0).nullable().optional(),
  costLimit: z.number().min(0).nullable().optional(),
  warningThreshold: z.number().min(1).max(100).optional(),
  criticalThreshold: z.number().min(1).max(100).optional(),
  emailAlerts: z.boolean().optional(),
  rateLimiting: z.boolean().optional(),
});

const endpointKeySchema = z.object({
  endpoint: z.string().trim().min(1).max(500),
  method: z.string().trim().min(1).max(10).transform((m) => m.toUpperCase()),
});

export const limitsRouter = createRouter({
  list: authedQuery.query(({ ctx }) => listUsageLimits(ctx.user.id)),

  get: authedQuery.input(endpointKeySchema).query(({ input, ctx }) =>
    getUsageLimit(ctx.user.id, input.endpoint, input.method),
  ),

  save: authedQuery
    .input(endpointKeySchema.extend({ config: configSchema }))
    .mutation(({ input, ctx }) =>
      saveUsageLimit(ctx.user.id, input.endpoint, input.method, input.config),
    ),

  remove: authedQuery
    .input(endpointKeySchema)
    .mutation(async ({ input, ctx }) => {
      await deleteUsageLimit(ctx.user.id, input.endpoint, input.method);
      return { ok: true };
    }),

  alerts: authedQuery.query(({ ctx }) => listUsageAlerts(ctx.user.id)),
});
