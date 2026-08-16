/**
 * Webhook real-time telemetry ingest.
 *
 * Lets an external API gateway push request telemetry as it happens —
 * no browser session required. Authenticate with a long-lived API key
 * created on the Webhooks page:
 *
 *   POST /api/webhook/ingest
 *   Authorization: Bearer apk_...
 *   Content-Type: application/json
 *
 * Body: a single telemetry event, or a batch: { "events": [...] }.
 *
 * The payload schema and rate-limit enforcement are identical to
 * `POST /api/ingest` (see api/ingest.ts), so telemetry recorded through
 * either channel feeds the same monitoring queries and usage limits.
 */

import { z } from "zod";
import { findUserByApiKey, touchApiKey } from "./queries/api-keys";
import { enforceAndRecord } from "./queries/usage";
import { ingestSchema, json } from "./ingest";

const batchSchema = z.object({
  events: z.array(ingestSchema).min(1).max(500),
});

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

export async function handleWebhookIngest(request: Request): Promise<Response> {
  const key = bearerToken(request);
  if (!key) {
    return json({ error: "Authentication required" }, 401);
  }

  const owner = await findUserByApiKey(key);
  if (!owner) {
    return json({ error: "Invalid API key" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  // Accept either a single event or a batch wrapper. Everything is
  // validated by the shared ingest schema.
  const single = ingestSchema.safeParse(body);
  const events = single.success
    ? [single.data]
    : batchSchema.safeParse(body).success
      ? batchSchema.parse(body).events
      : null;

  if (!events) {
    return json({ error: "Invalid telemetry payload" }, 400);
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = request.headers.get("user-agent");

  const received: { id: number; endpoint: string; method: string; statusCode: number }[] = [];
  let blocked: { endpoint: string; method: string; message: string; resetAt: string } | undefined;

  for (const event of events) {
    const result = await enforceAndRecord(
      owner.userId,
      {
        ...event,
        requestHeaders: event.requestHeaders ?? {},
        sourceIp: forwardedFor || null,
        userAgent,
        createdAt: new Date(),
      },
      new Date(),
    );

    if (!result.allowed) {
      const limit = result.limit;
      const times = [
        limit?.daily.resetAt,
        limit?.monthly.resetAt,
        limit?.cost.resetAt,
      ]
        .filter((d): d is Date => !!d)
        .map((d) => d.getTime());
      blocked = {
        endpoint: event.endpoint,
        method: event.method,
        message: `Rate limit exceeded for ${event.method} ${event.endpoint}`,
        resetAt: times.length ? new Date(Math.min(...times)).toISOString() : new Date().toISOString(),
      };
      break;
    }

    received.push({
      id: result.request.id,
      endpoint: event.endpoint,
      method: event.method,
      statusCode: event.statusCode,
    });
  }

  await touchApiKey(owner.keyId);

  if (blocked) {
    return json({ ok: false, blocked: true, ...blocked }, 429);
  }

  return json({ ok: true, received }, 201);
}
