"""
Ready-to-drop telemetry middleware for FastAPI (and any Starlette/ASGI app).

Every request your API serves is pushed as one event to the
fastapi-api-tracker webhook, so the dashboard automatically shows
failure rate, latency percentiles, endpoints, and (optionally) cost —
no changes to your route handlers.

Setup (3 steps):

1. Install the one dependency:  pip install httpx
2. Create an API key on the tracker's **Webhooks** page (starts with `apk_`).
3. Add the middleware:

   from telemetry import TelemetryMiddleware
   app.add_middleware(TelemetryMiddleware)

Security properties:
- The API key lives only in server-side env (`TRACKER_API_KEY`), never in
  code or logs, and is never sent to the browser.
- The request is dispatched as a background task AFTER the response is
  sent, so telemetry never blocks or slows your API.
- All exceptions inside telemetry are swallowed — a tracker outage can
  never break your API.
- Only an allowlisted subset of request headers is forwarded
  (never `Authorization`, cookies, or other credentials).
- The middleware never logs the event payload or the key.

Configuration (env vars):
- TRACKER_URL        Base URL of the tracker, e.g. https://tracker.example.com
                      (or http://localhost:3000 locally). Required.
- TRACKER_API_KEY    The `apk_...` key created in the tracker's Webhooks
                      page. Required.
- TRACKER_TIMEOUT    Per-attempt HTTP timeout in seconds. Default 2.0.
- TRACKER_ENDPOINT   Tracker ingest path. Default /api/webhook/ingest.

Optional extras:
- Pass `cost_cb=callable(request, response) -> float | None` to the
  middleware to report per-request cost (e.g. LLM token cost). The
  returned value is sent as the event's `cost` field.
- Use `check_rate_limit()` (exported below) in a dependency or gateway to
  pre-flight the tracker's configured per-endpoint limits before doing
  expensive work (advisory; the tracker enforces authoritatively on ingest).
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Awaitable, Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# ── Configuration (env) ──────────────────────────────────────────────────────

TRACKER_URL: str = os.environ.get("TRACKER_URL", "").rstrip("/")
TRACKER_API_KEY: str = os.environ.get("TRACKER_API_KEY", "")
TRACKER_TIMEOUT: float = float(os.environ.get("TRACKER_TIMEOUT", "2.0"))
TRACKER_ENDPOINT: str = os.environ.get("TRACKER_ENDPOINT", "/api/webhook/ingest")

# Headers that are safe to forward to the tracker. Never send credentials.
_SAFE_HEADERS = (
    "x-request-id",
    "content-type",
    "accept",
    "user-agent",
)

CostCallback = Callable[[Request, Response], Optional[float]]


def _build_event(
    request: Request,
    response: Response,
    latency_ms: float,
    cost_cb: Optional[CostCallback],
) -> dict[str, Any]:
    """Build one validated telemetry event from a request/response pair."""
    event: dict[str, Any] = {
        "endpoint": request.url.path,
        "method": request.method.upper(),
        "statusCode": response.status_code,
        "latencyMs": latency_ms,
        "requestHeaders": {
            header: value
            for header, value in request.headers.items()
            if header.lower() in _SAFE_HEADERS
        },
    }
    if response.status_code >= 400:
        # Generic, deterministic message — never echo internal details.
        event["errorMessage"] = "Request failed"
    if cost_cb is not None:
        try:
            cost = cost_cb(request, response)
            if cost is not None:
                event["cost"] = float(cost)
        except Exception:  # noqa: BLE001 - cost reporting must never break telemetry
            pass
    return event


async def _send_event(event: dict[str, Any]) -> None:
    """POST one event to the tracker with a short timeout and 1 retry."""
    if not TRACKER_URL or not TRACKER_API_KEY:
        return
    import httpx

    url = f"{TRACKER_URL}{TRACKER_ENDPOINT}"
    headers = {
        "Authorization": f"Bearer {TRACKER_API_KEY}",
        "Content-Type": "application/json",
    }
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=TRACKER_TIMEOUT) as client:
                await client.post(url, json=event, headers=headers)
            return
        except Exception:  # noqa: BLE001 - telemetry must never raise
            if attempt == 0:
                await asyncio.sleep(0.1)  # tiny backoff before the retry
            continue


class TelemetryMiddleware(BaseHTTPMiddleware):
    """
    Push one telemetry event per served request to the tracker.

    Usage:
        app.add_middleware(TelemetryMiddleware, cost_cb=my_cost_function)
    """

    def __init__(
        self,
        app: Any,
        cost_cb: Optional[CostCallback] = None,
        dispatch: Optional[Callable[..., Awaitable[Response]]] = None,
    ) -> None:
        super().__init__(app, dispatch)
        self.cost_cb = cost_cb

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # Re-raise for FastAPI's own error handling; nothing to report.
            raise
        latency_ms = round((time.perf_counter() - started) * 1000)
        try:
            event = _build_event(request, response, latency_ms, self.cost_cb)
            # Fire-and-forget: never await telemetry before returning.
            asyncio.get_running_loop().create_task(_send_event(event))
        except Exception:  # noqa: BLE001 - telemetry must never break the response
            pass
        return response


async def check_rate_limit(
    endpoint: str,
    method: str = "GET",
    timeout: float = 1.5,
) -> dict[str, Any]:
    """
    Pre-flight the tracker's configured limit for an endpoint (advisory).

    Returns {"allowed": True, ...} when under the limit, or
    {"allowed": False, "resetAt": ..., "message": ...} when the hard limit
    has been reached (HTTP 429). Call this before expensive work:

        limit = await check_rate_limit("/api/v1/search", "GET")
        if not limit["allowed"]:
            raise HTTPException(status_code=429, detail=limit.get("message"))

    The authoritative enforcement still happens on ingest, so this is an
    optimization, not the only guard.
    """
    if not TRACKER_URL or not TRACKER_API_KEY:
        return {"allowed": True, "limited": False}
    import httpx

    url = f"{TRACKER_URL}/api/check-limit"
    params = {"endpoint": endpoint, "method": method}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {TRACKER_API_KEY}"},
            )
            if resp.status_code == 200:
                return {"allowed": True, **resp.json()}
            if resp.status_code == 429:
                return {"allowed": False, **resp.json()}
            return {"allowed": True, "limited": False}
    except Exception:  # noqa: BLE001 - tracker outage must never block requests
        return {"allowed": True, "limited": False}
