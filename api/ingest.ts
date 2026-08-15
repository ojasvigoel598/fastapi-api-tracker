import { z } from "zod";
import { Session } from "@contracts/constants";
import { authenticateRequest } from "./context";
import { createRequestLog } from "./queries/monitoring";

const ingestSchema = z.object({
  endpoint: z.string().trim().min(1).max(500),
  method: z.string().trim().min(1).max(10).transform((value) => value.toUpperCase()),
  statusCode: z.number().int().min(100).max(599),
  latencyMs: z.number().int().min(0).max(86_400_000),
  responseSize: z.number().int().min(0).max(2_147_483_647).optional(),
  errorMessage: z.string().max(10_000).optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Record telemetry from a client that is signed in to this application.
 * The server owns the user id and timestamp; clients cannot submit either.
 */
export async function handleIngest(request: Request): Promise<Response> {
  const user = await authenticateRequest(request.headers);
  if (!user) return json({ error: "Authentication required" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid telemetry payload", issues: parsed.error.issues },
      400,
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const log = await createRequestLog({
    ...parsed.data,
    userId: user.id,
    requestHeaders: parsed.data.requestHeaders ?? {},
    sourceIp: forwardedFor || null,
    userAgent: request.headers.get("user-agent"),
    createdAt: new Date(),
  });

  return json({
    ok: true,
    id: log.id,
    receivedAt: log.createdAt.toISOString(),
    user: user.email,
    cookieName: Session.cookieName,
  }, 201);
}
