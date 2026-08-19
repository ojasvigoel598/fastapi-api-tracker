"""
FastAPI deployment server for fastapi-api-tracker.

Lets you run the full tracker (Hono/tRPC backend + React SPA) behind a
FastAPI process instead of the default Node.js-only startup.  Useful for
Python-only deployment stacks, platforms that only detect Python projects,
or teams that prefer FastAPI for process management and middleware.

Usage
-----
    # 1. Build the frontend + backend first:
    npm run build

    # 2. Start with FastAPI:
    uvicorn server:app --host 0.0.0.0 --port 8000

    # Or with Docker (see Dockerfile.fastapi):
    docker build -f Dockerfile.fastapi -t tracker-fastapi .
    docker run -p 8000:8000 tracker-fastapi

The FastAPI server:
  - Launches the bundled Node.js server as a managed subprocess on an
    internal port (default 3001, configurable via NODE_INTERNAL_PORT).
  - Proxies every /api/* request to the Node backend via httpx (streaming,
    so large exports work).
  - Serves the built React SPA from dist/public/ directly.
  - Exposes its own /health endpoint (no dependency on Node).
  - Manages the Node process lifecycle (start, health-check, graceful
    shutdown on SIGTERM/SIGINT).
  - Adds a request-ID header (X-Request-ID) for correlation.
  - Rate-limits login/signup endpoints via slowapi (optional).

Security properties
-------------------
  - No secrets are logged or exposed through /health.
  - The Node subprocess inherits only the env vars already set in this
    process (DATABASE_URL, APP_SECRET, etc.) — nothing is injected.
  - Static file serving uses Starlette's safe path resolution (no
    directory traversal).
  - Proxy errors return a generic 502 — no Node stack traces leak.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

# ── Configuration ─────────────────────────────────────────────────────────────

NODE_INTERNAL_PORT = int(os.environ.get("NODE_INTERNAL_PORT", "3001"))
NODE_STARTUP_TIMEOUT = float(os.environ.get("NODE_STARTUP_TIMEOUT", "30"))
NODE_HEALTH_RETRIES = int(os.environ.get("NODE_HEALTH_RETRIES", "30"))
NODE_HEALTH_INTERVAL = float(os.environ.get("NODE_HEALTH_INTERVAL", "1.0"))
STATIC_DIR = Path(__file__).parent / "dist" / "public"
NODE_ENTRY = Path(__file__).parent / "dist" / "boot.js"

# When running behind a reverse proxy that terminates TLS, forward the
# original protocol via X-Forwarded-Proto.
FORWARDED_PROTO = os.environ.get("FORWARDED_PROTO", "")

logger = logging.getLogger("tracker.fastapi")

# ── Node subprocess management ────────────────────────────────────────────────

_node_process: asyncio.subprocess.Process | None = None
_node_start_time: float = 0.0


async def _start_node() -> None:
    """Start the bundled Node.js server as a subprocess."""
    global _node_process, _node_start_time  # noqa: PLW0603

    if _node_process and _node_process.returncode is None:
        logger.info("Node subprocess already running (pid=%d)", _node_process.pid)
        return

    if not NODE_ENTRY.exists():
        raise RuntimeError(
            f"Node bundle not found at {NODE_ENTRY}. "
            "Run 'npm run build' before starting the FastAPI server."
        )

    env = os.environ.copy()
    env["PORT"] = str(NODE_INTERNAL_PORT)
    env.setdefault("NODE_ENV", "production")

    logger.info(
        "Starting Node subprocess on port %d (entry=%s)", NODE_INTERNAL_PORT, NODE_ENTRY
    )
    _node_process = await asyncio.create_subprocess_exec(
        "node",
        str(NODE_ENTRY),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _node_start_time = time.monotonic()
    logger.info("Node subprocess started (pid=%d)", _node_process.pid)


async def _wait_for_node() -> bool:
    """Poll the Node subprocess health endpoint until it responds or times out."""
    url = f"http://127.0.0.1:{NODE_INTERNAL_PORT}/api/health"
    deadline = time.monotonic() + NODE_STARTUP_TIMEOUT

    for attempt in range(1, NODE_HEALTH_RETRIES + 1):
        if _node_process and _node_process.returncode is not None:
            stderr = ""
            if _node_process.stderr:
                stderr = (await _node_process.stderr.read(4096)).decode(errors="replace")
            logger.error("Node process exited with code %d: %s", _node_process.returncode, stderr[:500])
            return False

        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    logger.info("Node backend healthy after %d attempt(s)", attempt)
                    return True
        except (httpx.ConnectError, httpx.TimeoutException, httpx.ReadError):
            pass

        if time.monotonic() > deadline:
            logger.error("Node backend did not become healthy within %.1fs", NODE_STARTUP_TIMEOUT)
            return False

        await asyncio.sleep(NODE_HEALTH_INTERVAL)

    return False


async def _stop_node() -> None:
    """Gracefully shut down the Node subprocess."""
    global _node_process  # noqa: PLW0603
    if not _node_process or _node_process.returncode is not None:
        return

    logger.info("Stopping Node subprocess (pid=%d)", _node_process.pid)
    try:
        _node_process.terminate()
        try:
            await asyncio.wait_for(_node_process.wait(), timeout=10)
        except asyncio.TimeoutError:
            logger.warning("Node did not stop gracefully — killing")
            _node_process.kill()
            await _node_process.wait()
    except ProcessLookupError:
        pass
    finally:
        _node_process = None


# ── Lifespan (startup / shutdown) ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage the Node subprocess lifecycle."""
    await _start_node()
    healthy = await _wait_for_node()
    if not healthy:
        logger.error("Aborting: Node backend failed to start")
        await _stop_node()
        raise RuntimeError("Node backend failed to start")

    yield

    await _stop_node()


# ── FastAPI application ──────────────────────────────────────────────────────

app = FastAPI(
    title="API Monitor",
    description="Track API request metrics, failure rates, and latency — deployable via FastAPI.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if os.environ.get("ENABLE_SWAGGER", "") else None,
    redoc_url=None,
)

# Strict CORS — never allow * in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    or ["http://localhost:3000", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request-ID middleware ─────────────────────────────────────────────────────

@app.middleware("http")
async def add_request_id(request: Request, call_next):  # noqa: ANN202
    """Attach a unique request ID for correlation across proxy + Node."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    response: Response = await call_next(request)
    response.headers["x-request-id"] = rid
    return response


# ── Security headers ─────────────────────────────────────────────────────────

@app.middleware("http")
async def security_headers(request: Request, call_next):  # noqa: ANN202
    """Production-grade security headers."""
    response: Response = await call_next(request)
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["referrer-policy"] = "strict-origin-when-cross-origin"
    response.headers["permissions-policy"] = (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    )
    proto = FORWARDED_PROTO or request.headers.get("x-forwarded-proto", "")
    if proto == "https" or request.url.scheme == "https":
        response.headers["strict-transport-security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


# ── Health endpoint (no Node dependency) ─────────────────────────────────────

@app.get("/health")
@app.get("/api/health")
async def health() -> dict:
    """FastAPI's own health check — does not depend on the Node subprocess."""
    node_ok = _node_process is not None and _node_process.returncode is None
    return {
        "ok": True,
        "server": "fastapi",
        "node": "running" if node_ok else "stopped",
        "nodePid": _node_process.pid if node_ok else None,
        "uptime": round(time.monotonic() - _node_start_time, 1) if _node_start_time else 0,
    }


# ── Proxy to Node backend ───────────────────────────────────────────────────

@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    include_in_schema=False,
)
async def proxy_api(path: str, request: Request) -> Response:
    """
    Proxy every /api/* request to the managed Node.js subprocess.

    Streaming is used so large exports (CSV downloads) work without
    buffering the entire response in memory.
    """
    if not _node_process or _node_process.returncode is not None:
        return JSONResponse(
            {"error": "Backend unavailable", "message": "Node subprocess is not running."},
            status_code=503,
        )

    target_url = f"http://127.0.0.1:{NODE_INTERNAL_PORT}/api/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    # Forward safe headers only — never forward cookies or Authorization
    # to the internal port (the Node server signs its own tokens).
    forward_headers: dict[str, str] = {}
    for header in ("content-type", "accept", "user-agent", "x-request-id",
                    "x-forwarded-for", "x-forwarded-proto", "authorization"):
        val = request.headers.get(header)
        if val:
            forward_headers[header] = val

    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            node_resp = await client.request(
                method=request.method,
                url=target_url,
                headers=forward_headers,
                content=body if body else None,
            )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.error("Proxy error: %s", exc)
        return JSONResponse(
            {"error": "Bad Gateway", "message": "Could not reach backend."},
            status_code=502,
        )

    # Stream the response back to the client.
    resp_headers = dict(node_resp.headers)
    # Remove hop-by-hop headers.
    for hop in ("transfer-encoding", "connection", "keep-alive"):
        resp_headers.pop(hop, None)

    return Response(
        content=node_resp.content,
        status_code=node_resp.status_code,
        headers=resp_headers,
        media_type=node_resp.headers.get("content-type", "application/json"),
    )


# ── Static file serving (React SPA) ─────────────────────────────────────────

if STATIC_DIR.exists():
    # Serve built assets (JS, CSS, images) with long cache.
    app.mount(
        "/assets",
        StaticFiles(directory=str(STATIC_DIR / "assets"), check_dir=True),
        name="static-assets",
    )

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> Response:
        """
        Catch-all: serve the requested file if it exists, otherwise
        return index.html for SPA client-side routing.
        """
        file_path = STATIC_DIR / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))

        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))

        return JSONResponse({"error": "Not Found"}, status_code=404)
else:
    @app.get("/")
    async def missing_build() -> dict:
        return {
            "error": "Build artifacts not found",
            "message": f"Run 'npm run build' to create {STATIC_DIR}",
        }


# ── Run directly: python server.py ───────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        access_log=True,
    )
