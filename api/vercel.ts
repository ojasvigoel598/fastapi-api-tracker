/**
 * Vercel serverless entry point (Build Output API).
 *
 * The repo's backend source lives in `api/`, which collides with Vercel's
 * convention that every file in the root `api/` directory becomes its own
 * serverless function. We therefore deploy via the Build Output API:
 * `scripts/vercel-build.mjs` bundles this file into a single catch-all
 * function (`.vercel/output/functions/api.func`) and routes `/api/*` to it.
 *
 * `config.json` routes `/api/*` to the function with `dest: "/api?vercelPath=$1"`.
 * Depending on the Vercel routing version the function either (a) receives the
 * rewritten path `/api` with the original as the `vercelPath` query param, or
 * (b) receives the original path unchanged. `reconstructUrl` restores the
 * original URL in both cases so Hono's routes (`/api/trpc/*`,
 * `/api/webhook/ingest`, ...) see exactly what the client sent.
 */
import app from "./boot";

export function reconstructUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const vercelPath = url.searchParams.get("vercelPath");
  if (vercelPath !== null) {
    const trimmed = url.pathname.replace(/\/+$/, "");
    if (trimmed === "/api") {
      const rest = vercelPath
        ? vercelPath.startsWith("/")
          ? vercelPath
          : `/${vercelPath}`
        : "";
      url.pathname = `/api${rest}`;
    }
    url.searchParams.delete("vercelPath");
  }
  return url;
}

async function handler(req: Request): Promise<Response> {
  const url = reconstructUrl(req.url);
  return app.fetch(new Request(url, req));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
