/**
 * Webhook Deliveries data layer.
 *
 * Keeps the most recent webhook ingest batches per user so a signed-in user
 * can re-fire a delivery ("replay") without re-sending it from their API
 * gateway. Stores the exact validated event payloads that were submitted.
 *
 * Demo mode keeps deliveries in memory (mirroring api/demo/store.ts); the
 * MySQL/Drizzle path is used whenever DATABASE_URL is configured.
 */

import { and, desc, eq, notInArray } from "drizzle-orm";
import { getDb } from "./connection";
import { env } from "../lib/env";
import { webhookDeliveries, type WebhookDelivery } from "@db/schema";

/** Keep only the most recent N deliveries per user. */
export const MAX_DELIVERIES_PER_USER = 25;

export type DeliverySummary = Pick<
  WebhookDelivery,
  "id" | "keyName" | "outcome" | "eventCount" | "receivedAt"
>;

export type DeliveryOutcome = "received" | "blocked";

// ─── Demo-mode in-memory store ────────────────────────────────────────

let demoDeliveries: WebhookDelivery[] = [];
let nextDemoDeliveryId = 1;

function toSummary(d: WebhookDelivery): DeliverySummary {
  return {
    id: d.id,
    keyName: d.keyName,
    outcome: d.outcome,
    eventCount: d.eventCount,
    receivedAt: d.receivedAt,
  };
}

// ─── Recording ────────────────────────────────────────────────────────

/**
 * Persist a received (or rate-limit-blocked) webhook batch, then trim the
 * per-user history to the most recent MAX_DELIVERIES_PER_USER.
 * Returns the new delivery id.
 */
export async function recordWebhookDelivery(input: {
  userId: number;
  keyId: number;
  keyName: string | null;
  outcome: DeliveryOutcome;
  events: Record<string, unknown>[];
}): Promise<number> {
  if (env.isDemoMode) {
    const delivery: WebhookDelivery = {
      id: nextDemoDeliveryId++,
      userId: input.userId,
      keyId: input.keyId,
      keyName: input.keyName,
      outcome: input.outcome,
      eventCount: input.events.length,
      events: input.events,
      receivedAt: new Date(),
    };
    demoDeliveries.push(delivery);
    trimDemo(input.userId);
    return delivery.id;
  }

  const db = getDb();
  const [result] = await db
    .insert(webhookDeliveries)
    .values({
      userId: input.userId,
      keyId: input.keyId,
      keyName: input.keyName,
      outcome: input.outcome,
      eventCount: input.events.length,
      events: input.events,
      // Always pass the timestamp explicitly (the api_requests pattern): a
      // bare now() column default would round to whole seconds.
      receivedAt: new Date(),
    })
    .$returningId();
  await trimMysql(db, input.userId);
  return result.id;
}

function trimDemo(userId: number): void {
  const mine = demoDeliveries
    .filter((d) => d.userId === userId)
    .sort(
      (a, b) =>
        b.receivedAt.getTime() - a.receivedAt.getTime() || b.id - a.id,
    );
  if (mine.length <= MAX_DELIVERIES_PER_USER) return;
  const dropIds = new Set(
    mine.slice(MAX_DELIVERIES_PER_USER).map((d) => d.id),
  );
  demoDeliveries = demoDeliveries.filter((d) => !dropIds.has(d.id));
}

async function trimMysql(
  db: ReturnType<typeof getDb>,
  userId: number,
): Promise<void> {
  // MySQL error 1093: a DELETE cannot read from the same table it is
  // modifying, so the "keep newest N" subquery must be wrapped in a derived
  // table (`select id from (select ... limit N) keep`).
  const keep = db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.userId, userId))
    .orderBy(desc(webhookDeliveries.id))
    .limit(MAX_DELIVERIES_PER_USER)
    .as("keep");
  const keepDerived = db.select({ id: keep.id }).from(keep);

  await db.delete(webhookDeliveries).where(
    and(
      eq(webhookDeliveries.userId, userId),
      notInArray(webhookDeliveries.id, keepDerived),
    ),
  );
}

// ─── Reading ──────────────────────────────────────────────────────────

export async function listWebhookDeliveries(
  userId: number,
): Promise<DeliverySummary[]> {
  if (env.isDemoMode) {
    return demoDeliveries
      .filter((d) => d.userId === userId)
      .sort(
        (a, b) =>
          b.receivedAt.getTime() - a.receivedAt.getTime() || b.id - a.id,
      )
      .slice(0, MAX_DELIVERIES_PER_USER)
      .map(toSummary);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.userId, userId))
    .orderBy(desc(webhookDeliveries.receivedAt), desc(webhookDeliveries.id))
    .limit(MAX_DELIVERIES_PER_USER);
  return rows.map(toSummary);
}

/** Fetch a delivery (including its raw events) — scoped to the owner. */
export async function getWebhookDelivery(
  userId: number,
  id: number,
): Promise<WebhookDelivery | undefined> {
  if (env.isDemoMode) {
    return demoDeliveries.find((d) => d.id === id && d.userId === userId);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.userId, userId)))
    .limit(1);
  return rows.at(0);
}

/** Wipe a user's delivery history (used by seed.clear). */
export async function clearWebhookDeliveries(userId: number): Promise<void> {
  if (env.isDemoMode) {
    demoDeliveries = demoDeliveries.filter((d) => d.userId !== userId);
    return;
  }
  const db = getDb();
  await db.delete(webhookDeliveries).where(eq(webhookDeliveries.userId, userId));
}
