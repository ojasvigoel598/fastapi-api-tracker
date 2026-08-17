/**
 * Webhooks tRPC Router
 *
 * Manages the long-lived API keys that authenticate the real-time
 * telemetry webhook (`POST /api/webhook/ingest`). Keys are scoped to the
 * signed-in user; the plaintext is returned once at creation and only a
 * hash is stored.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "./queries/api-keys";
import {
  getWebhookDelivery,
  listWebhookDeliveries,
} from "./queries/webhook-deliveries";
import { ingestEvents, recordDelivery, type IngestEvent } from "./webhook";

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

  /** Most recent webhook deliveries (metadata only, capped per user). */
  listDeliveries: authedQuery.query(({ ctx }) =>
    listWebhookDeliveries(ctx.user.id),
  ),

  /**
   * Re-fire a past webhook delivery through the same ingest + rate-limit
   * path. The replayed events land as new monitoring rows (rate limits
   * apply, so an over-limit batch is blocked again) and the replay itself
   * is recorded as a new delivery.
   */
  replayDelivery: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const delivery = await getWebhookDelivery(ctx.user.id, input.id);
      if (!delivery) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Delivery not found",
        });
      }

      const owner = {
        userId: ctx.user.id,
        keyId: delivery.keyId ?? 0,
        keyName: delivery.keyName ?? "replay",
      };
      const events = delivery.events as unknown as IngestEvent[];
      const { received, blocked } = await ingestEvents(owner, events);
      const replayId = await recordDelivery(
        owner,
        events,
        blocked ? "blocked" : "received",
      );

      return {
        replayId,
        received: received.length,
        blocked: Boolean(blocked),
        firstEvent: received[0] ?? undefined,
      };
    }),
});
