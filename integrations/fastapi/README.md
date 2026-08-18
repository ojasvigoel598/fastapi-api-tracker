# FastAPI telemetry integration

Track any FastAPI (or Starlette/ASGI) app in the fastapi-api-tracker
dashboard — failure rate, latency, endpoints, and cost — with **one file
and three lines of setup**. No changes to your routes.

## How it works

The tracker cannot see traffic it is not told about, so your API pushes
one telemetry event per served request to the tracker's webhook:

```
your FastAPI app ──POST /api/webhook/ingest (Bearer apk_...)──▶ tracker dashboard
```

The middleware:

- Runs **fire-and-forget** — the event is dispatched as a background task
  after the response is sent, so telemetry adds ~0 ms to your requests and
  can never slow your API down.
- **Never raises** — a tracker outage is invisible to your users.
- Forwards only an **allowlisted subset of headers** (`x-request-id`,
  `content-type`, `accept`, `user-agent`) — never `Authorization`, cookies,
  or credentials.
- Reports a **generic error message** for failed requests — internal
  details never leave your process.
- Stores the key only in server-side env and never logs it.

## Setup (under a minute)

```bash
pip install httpx
```

Copy `telemetry.py` next to your app (or into your project), create an
API key on the tracker's **Webhooks** page, then:

```python
import os
from fastapi import FastAPI
from telemetry import TelemetryMiddleware

app = FastAPI()
app.add_middleware(TelemetryMiddleware)
```

Environment variables (server-side only, never in the browser):

| Variable | Required | Description |
| --- | --- | --- |
| `TRACKER_URL` | Yes | Tracker base URL, e.g. `https://tracker.example.com` (or `http://localhost:3000`). |
| `TRACKER_API_KEY` | Yes | The `apk_...` key from the Webhooks page. |
| `TRACKER_TIMEOUT` | No | Per-attempt HTTP timeout, seconds (default `2.0`). |
| `TRACKER_ENDPOINT` | No | Ingest path (default `/api/webhook/ingest`). |

## Cost tracking (optional)

Pass a callback that returns the per-request cost (e.g. LLM token cost):

```python
def request_cost(request, response):
    # tokens_used = request.state.tokens  # whatever you tracked in a dependency
    # return round(tokens_used * 0.000002, 6)
    return None

app.add_middleware(TelemetryMiddleware, cost_cb=request_cost)
```

## Pre-flight rate-limit checks (optional)

If you configured limits per endpoint in the tracker's **Limits** page,
you can reject over-limit work before it starts:

```python
from fastapi import HTTPException
from telemetry import check_rate_limit

@app.get("/api/v1/search")
async def search():
    limit = await check_rate_limit("/api/v1/search", "GET")
    if not limit["allowed"]:
        raise HTTPException(status_code=429, detail=limit.get("message"))
    ...
```

This is advisory — the tracker enforces the limit authoritatively at
ingest and rejects over-limit telemetry with `429`.

## Verifying it works

1. Start the tracker (`npm run dev`, sign in, create a key).
2. Run your FastAPI app with the middleware and hit a few endpoints.
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
