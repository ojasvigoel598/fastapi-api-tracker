/**
 * Smoke-tests the built Vercel function the way Vercel's router invokes it.
 *
 * Simulates the config.json rewrite (`/api/health` -> `/api?vercelPath=/health`)
 * against `.vercel/output/functions/api.func/index.mjs` and verifies the app
 * answers. Run after `npm run build:vercel`.
 */
const { GET, POST } = await import(
  "../.vercel/output/functions/api.func/index.mjs"
);

function assert(cond, msg) {
  if (!cond) {
    console.error(`[vercel-smoke] FAIL: ${msg}`);
    process.exit(1);
  }
}

// 1) Health probe through the rewritten route.
const health = await GET(new Request("http://localhost/api?vercelPath=/health"));
assert(health.status === 200, `health status ${health.status}`);
const healthBody = await health.json();
assert(healthBody.ok === true, `health body ${JSON.stringify(healthBody)}`);
console.log(`[vercel-smoke] GET /api/health -> ${health.status} (mode=${healthBody.mode})`);

// 2) tRPC query (the client uses httpBatchLink, so queries are GETs).
//    Unauthenticated -> tRPC UNAUTHORIZED (401).
const me = await GET(
  new Request("http://localhost/api?vercelPath=/trpc/auth.me&batch=1&input=%7B%7D"),
);
assert(me.status === 401, `tRPC auth.me status ${me.status}`);
console.log(`[vercel-smoke] GET /api/trpc/auth.me (unauthenticated) -> ${me.status}`);

// 3) tRPC mutation over POST -> still the auth gate (401), proving POST bodies
//    survive the rewrite.
const logout = await POST(
  new Request("http://localhost/api?vercelPath=/trpc/auth.logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: null, meta: { values: {} } }),
  }),
);
assert(logout.status === 401, `tRPC auth.logout status ${logout.status}`);
console.log(`[vercel-smoke] POST /api/trpc/auth.logout (unauthenticated) -> ${logout.status}`);

// 4) Webhook ingest with an invalid key -> 401, proving the webhook route and
//    body handling work through the rewrite.
const webhook = await POST(
  new Request("http://localhost/api?vercelPath=/webhook/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer invalid-key" },
    body: JSON.stringify({ name: "orders", latency: 1, status: 200 }),
  }),
);
assert(webhook.status === 401, `webhook ingest status ${webhook.status}`);
console.log(`[vercel-smoke] POST /api/webhook/ingest (bad key) -> ${webhook.status}`);

// 5) Unknown API path still returns the app's JSON 404.
const missing = await GET(new Request("http://localhost/api?vercelPath=/nope"));
assert(missing.status === 404, `unknown api status ${missing.status}`);
console.log(`[vercel-smoke] GET /api/nope -> ${missing.status}`);

// 6) Preserved-path form (newer Vercel routing) is handled without double-prefixing.
const preserved = await GET(
  new Request("http://localhost/api/health?vercelPath=/health"),
);
assert(preserved.status === 200, `preserved-path health status ${preserved.status}`);
console.log(`[vercel-smoke] preserved-path /api/health -> ${preserved.status}`);

console.log("[vercel-smoke] OK — all checks passed");
