# Express / Node telemetry integration

Track any Express (or plain Node HTTP) app in the fastapi-api-tracker
dashboard — failure rate, latency, endpoints, and cost — with **one file
and two lines of setup**. No changes to your routes.

## How it works

The tracker cannot see traffic it is not told about, so your API pushes
one telemetry event per served request to the tracker's webhook:

```
your Express app ──POST /api/webhook/ingest (Bearer apk_...)──▶ tracker dashboard
```

The middleware:

- Runs **fire-and-forget** — the event is dispatched after the response
  finishes, so telemetry adds ~0 ms and can never slow your API down.
- **Never throws** — a tracker outage is invisible to your users.
- Forwards only an **allowlisted subset of headers** (`x-request-id`,
  `content-type`, `accept`, `user-agent`) — never `Authorization`, cookies,
  or credentials.
- Reports a **generic error message** for failed requests — internal
  details never leave your process.
- Stores the key only in server-side env and never logs it.

## Setup (under a minute)

Requires Node 18+ (global `fetch`). No npm dependencies.

```js
import express from "express";
import { telemetryMiddleware } from "./telemetry.mjs";

const app = express();
app.use(telemetryMiddleware());
```

Create an API key on the tracker's **Webhooks** page, then set two env
vars on your API server (never in the browser):

| Variable | Required | Description |
| --- | --- | --- |
| `TRACKER_URL` | Yes | Tracker base URL, e.g. `https://tracker.example.com` (or `http://localhost:3000`). |
| `TRACKER_API_KEY` | Yes | The `apk_...` key from the Webhooks page. |
| `TRACKER_TIMEOUT` | No | Per-attempt HTTP timeout, ms (default `2000`). |
| `TRACKER_ENDPOINT` | No | Ingest path (default `/api/webhook/ingest`). |

## Cost tracking (optional)

Pass a callback that returns the per-request cost (e.g. LLM token cost):

```js
app.use(telemetryMiddleware({ costCb: (req, res) => {
  // tokensUsed = req.tokens  // whatever you tracked in a middleware
  // return Math.round(tokensUsed * 0.000002 * 1e6) / 1e6;
  return null;
}}));
```

## Pre-flight rate-limit checks (optional)

If you configured limits per endpoint in the tracker's **Limits** page,
reject over-limit work before it starts:

```js
import { checkRateLimit } from "./telemetry.mjs";

app.get("/api/v1/search", async (req, res) => {
  const limit = await checkRateLimit("/api/v1/search", "GET");
  if (!limit.allowed) {
    res.status(429).json({ error: limit.message ?? "Rate limit exceeded" });
    return;
  }
  // ...expensive work
});
```

This is advisory — the tracker enforces the limit authoritatively at
ingest and rejects over-limit telemetry with `429`.

## Verifying it works

1. Start the tracker (`npm run dev`, sign in, create a key).
2. Run your Express app with the middleware and hit a few endpoints.
3. The tracker dashboard updates within ~10 s: request counts, failure
   rate, latency percentiles, and the new endpoints appear automatically.
4. Each delivery (including blocked batches) is listed under
   **Webhooks → Recent deliveries** and can be replayed.

## Security checklist for this integration

- ✅ Key lives only in server-side env (`TRACKER_API_KEY`), never in code
  or git.
- ✅ Telemetry is fire-and-forget with a hard timeout and retry cap.
- ✅ Only safe headers forwarded; credentials never leave your process.
- ✅ Errors are generic; stack traces and payloads are never logged.
- ✅ If the tracker is unreachable, your API is unaffected.
