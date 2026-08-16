/**
 * Webhooks tRPC Router
 *
 * Manages the long-lived API keys that authenticate the real-time
 * telemetry webhook (`POST /api/webhook/ingest`). Keys are scoped to the
 * signed-in user; the plaintext is returned once at creation and only a
 * hash is stored.
 */

import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "./queries/api-keys";

export const webhooksRouter = createRouter({
  /** Create a key; the returned `key` value is shown exactly once. */
  createKey: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
      }),
    )
    .mutation(({ input, ctx }) =>
      createApiKey(ctx.user.id, input.name),
    ),

  listKeys: authedQuery.query(({ ctx }) => listApiKeys(ctx.user.id)),

  revokeKey: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input, ctx }) => revokeApiKey(ctx.user.id, input.id)),
});
