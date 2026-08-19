import { z } from "zod";
import { Session } from "@contracts/constants";
import { authenticateRequest } from "./context";
import { readJsonBounded } from "./lib/body";
import { enforceAndRecord, getUsageLimit } from "./queries/usage";

// Bounds for map-typed inputs so a hostile client cannot exhaust memory by
// sending a huge JSON object (an unbounded z.record would happily accept
// tens of thousands of keys). Values are capped in both count and size.
const MAX_HEADERS = 50;
const MAX_HEADER_KEY_LEN = 200;
const MAX_HEADER_VALUE_LEN = 2_000;

export const headersMapSchema = z
  .record(z.string().trim().min(1).max(MAX_HEADER_KEY_LEN), z.string().max(MAX_HEADER_VALUE_LEN))
  .refine(
    (headers) => Object.keys(headers).length <= MAX_HEADERS,
    `requestHeaders supports at most ${MAX_HEADERS} entries`,
  );

export const ingestSchema = z.object({
  endpoint: z.string().trim().min(1).max(500),
  method: z.string().trim().min(1).max(10).transform((value) => value.toUpperCase()),
  statusCode: z.number().int().min(100).max(599),
  latencyMs: z.number().int().min(0).max(86_400_000),
  responseSize: z.number().int().min(0).max(2_147_483_647).optional(),
  errorMessage: z.string().max(10_000).optional(),
  requestHeaders: headersMapSchema.optional(),
  cost: z.number().min(0).optional(),
});

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Record telemetry from a client that is signed in to this application.
 * The server owns the user id and timestamp; clients cannot submit either.
 *
 * When a rate-limit config with `rateLimiting` enabled has reached its hard
 * limit, the request is rejected with 429 and recorded as a blocked request
 * (not counted as usage).
 */
export async function handleIngest(request: Request): Promise<Response> {
  const user = await authenticateRequest(request.headers);
  if (!user) return json({ error: "Authentication required" }, 401);

  const read = await readJsonBounded(request);
  if (!read.ok) {
    return json(
      { error: read.reason === "too_large" ? "Payload Too Large" : "Request body must be valid JSON" },
      read.reason === "too_large" ? 413 : 400,
    );
  }

  const parsed = ingestSchema.safeParse(read.value);
  if (!parsed.success) {
    return json(
      { error: "Invalid telemetry payload", issues: parsed.error.issues },
      400,
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const result = await enforceAndRecord(
    user.id,
    {
      ...parsed.data,
      requestHeaders: parsed.data.requestHeaders ?? {},
      sourceIp: forwardedFor || null,
      userAgent: request.headers.get("user-agent"),
      createdAt: new Date(),
    },
    new Date(),
  );

  if (!result.allowed) {
    const limit = result.limit;
    return json(
      {
        error: "Rate limit exceeded",
        message: `The request limit for ${parsed.data.method} ${parsed.data.endpoint} has been reached. Requests are rejected until the usage period resets.`,
        blocked: true,
        limit: limit
          ? {
              daily: limit.daily,
              monthly: limit.monthly,
              cost: limit.cost,
              resetAt: earliestReset(limit),
            }
          : undefined,
      },
      429,
    );
  }

  return json(
    {
      ok: true,
      id: result.request.id,
      receivedAt: result.request.createdAt.toISOString(),
      user: user.email,
      cookieName: Session.cookieName,
    },
    201,
  );
}

function earliestReset(limit: {
  daily: { resetAt: Date };
  monthly: { resetAt: Date };
  cost: { resetAt: Date };
}): string {
  const times = [limit.daily.resetAt, limit.monthly.resetAt, limit.cost.resetAt]
    .map((d) => d.getTime())
    .filter((n) => Number.isFinite(n));
  return new Date(Math.min(...times)).toISOString();
}

/**
 * Pre-flight rate-limit check for a client's API gateway.
 *
 * `GET /api/check-limit?endpoint=...&method=...`
 *
 * Returns 200 { allowed: true, ... } while under the limit, or 429 with
 * remaining/reset metadata once the hard limit is reached. This is advisory;
 * the authoritative enforcement happens on `POST /api/ingest`.
 */
export async function handleCheckLimit(request: Request): Promise<Response> {
  const user = await authenticateRequest(request.headers);
  if (!user) return json({ error: "Authentication required" }, 401);

  const url = new URL(request.url);
  const endpoint = (url.searchParams.get("endpoint") ?? "").trim();
  const method = (url.searchParams.get("method") ?? "").trim().toUpperCase();

  if (!endpoint || !method) {
    return json({ error: "Missing 'endpoint' or 'method' query parameter" }, 400);
  }

  const limit = await getUsageLimit(user.id, endpoint, method);

  // No config → no limits → always allowed.
  if (!limit || !limit.rateLimiting) {
    return json({
      allowed: true,
      limited: false,
      endpoint,
      method,
    });
  }

  if (!limit.rateLimited) {
    return json({
      allowed: true,
      limited: true,
      endpoint,
      method,
      daily: limit.daily,
      monthly: limit.monthly,
      cost: limit.cost,
    });
  }

  return json(
    {
      allowed: false,
      limited: true,
      endpoint,
      method,
      daily: limit.daily,
      monthly: limit.monthly,
      cost: limit.cost,
      resetAt: earliestReset(limit),
      message: "Rate limit exceeded",
    },
    429,
  );
}
