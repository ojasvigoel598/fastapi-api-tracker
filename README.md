# API Monitor

**Real-time API monitoring, analytics, and alerting — run it in 30 seconds, wire it to your API in 5 minutes.**

![CI](https://github.com/ojasvigoel598/fastapi-api-tracker/actions/workflows/ci.yml/badge.svg)
![PR Checks](https://github.com/ojasvigoel598/fastapi-api-tracker/actions/workflows/pr.yml/badge.svg)
[![Docker](https://ghcr-badge.egpl.dev/ojasvigoel598/fastapi-api-tracker/latest_tag?label=docker&color=%2344cc11)](https://github.com/ojasvigoel598/fastapi-api-tracker/pkgs/container/fastapi-api-tracker)
[![Docker pulls](https://ghcr-badge.elias.eu.org/shield/ojasvigoel598/fastapi-api-tracker)](https://github.com/ojasvigoel598/fastapi-api-tracker/pkgs/container/fastapi-api-tracker)
[![Docker size](https://ghcr-badge.egpl.dev/ojasvigoel598/fastapi-api-tracker/size?tag=latest&label=image%20size&color=%2344cc11)](https://github.com/ojasvigoel598/fastapi-api-tracker/pkgs/container/fastapi-api-tracker)

API Monitor is a full-stack dashboard that tracks your API's request logs, failure rates, latency percentiles, endpoints, alerts, and AI-assisted insights — with per-user isolation and enforced rate/cost limits. It's the "Grafana for your own API" without the setup.

**What is this? → How do I try it? → How does it work?** — everything below.

---

## 🎮 Try the app now (2 minutes, zero credentials)

There is **no hosted demo URL yet** — but you don't need one. The app runs with **no API keys, no database, and no signup**:

```bash
npm install
npm run dev        # http://localhost:3000
```

Then open the app and sign in with the seeded demo account:

| | |
| --- | --- |
| **Email** | `demo@example.com` |
| **Password** | `demo1234` |

…or click **"Use demo account"** on the login screen — it's one click. You land on a fully populated dashboard (KPI cards, charts, insights, failures) because each new account is seeded with demo telemetry. No internet required.

**Prefer Docker?** One command, MySQL included:

```bash
docker compose up --build   # app → http://localhost:3000
```

**Deploy it instead?** It's Vercel-ready and ships a one-command deploy setup — see [Deploy to Vercel](#deploy-to-vercel).

> **Works on:** desktop browsers (primary). The UI is responsive and adapts to smaller screens — see [📱 Mobile support](#-mobile-support).

---

## 📸 Demo

![API Monitor demo — login, dashboard, analytics, endpoints, alerts, limits, webhooks](docs/demo.gif)

The dashboard is live-updating: every 10s it re-polls, so telemetry pushed through the webhook appears without a manual refresh.

| | |
| --- | --- |
| ![Login screen with demo-account button](docs/screenshots/01-login.png) | ![Request logs table](docs/screenshots/03-requests.png) |
| ![Analytics with charts](docs/screenshots/04-analytics.png) | ![Endpoints table with percentiles](docs/screenshots/05-endpoints.png) |
| ![Alerts list](docs/screenshots/06-alerts.png) | ![Limits & rate limiting](docs/screenshots/07-limits.png) |
| ![Webhooks with API keys and deliveries](docs/screenshots/08-webhooks.png) | |

> **Want a fresh recording?** Run `node scripts/capture-demo.mjs` to recapture all screenshots and generate an animated GIF from the live app (requires Chrome).

---

## 🕹️ How to use it (first 5 minutes)

1. **Sign in** (use the demo account above, or create your own — each account is fully isolated).
2. **Look around** — the Dashboard shows total requests, failure rate, average latency, active endpoints, charts, automated insights, top endpoints, active alerts, and recent failures. Try the time-range picker (24h / 7d / 30d / custom).
3. **Create a webhook key** — open **Webhooks → Create key** and copy the `apk_...` token (shown exactly once, stored hashed).
4. **Push real telemetry** from your terminal:

   ```bash
   curl -X POST http://localhost:3000/api/webhook/ingest \
     -H "Authorization: Bearer apk_..." \
     -H "Content-Type: application/json" \
     -d '{"endpoint":"/api/v1/users","method":"GET","statusCode":200,"latencyMs":42}'
   ```

5. **Watch it appear live** — within ~10 seconds the dashboard shows the new request, auto-discovers the endpoint, and updates failure rate / latency percentiles. Send a `statusCode: 503` event and watch it land in **Recent Failures**.
6. **Set a limit** — open **Limits**, configure a daily cap on an endpoint, then hammer the webhook: over-limit requests are blocked with `429` and counted as blocked, atomically.

**Want the tracker to collect from your API automatically?** Drop in one of the ready-to-use middleware files — [FastAPI](integrations/fastapi/telemetry.py) or [Express/Node](integrations/express/telemetry.mjs) — see [Track your own API](#track-your-own-api-fastapi--express).

---

## ✨ Features

- **Live telemetry webhook** — external APIs/gateways push events as they happen (single or batched, up to 500 per call); the dashboard refreshes every 10s.
- **Analytics** — request volume, failure rate, status-code distribution, latency distribution, and per-endpoint **p50/p95/p99 percentiles** computed in MySQL with window functions.
- **Automated AI insights** — anomalies and trends explained in plain language (optional Kimi integration; deterministic mock mode offline).
- **Alerts** — configurable thresholds with severity, acknowledgment, and optional email alerts (Resend).
- **Limits & rate limiting** — hard daily/monthly/cost caps per endpoint, enforced **atomically** at ingest (row-lock transaction — concurrent bursts can't over-count).
- **Webhook replay** — the last 25 deliveries per account are stored; re-fire any of them from the UI or over REST.
- **Multi-user isolation** — every row is scoped to the signed-in user; one account can never read another's data (RLS-equivalent at the query layer).
- **Flexible auth** — local email/password (zero-credential default) or optional Clerk / Supabase.
- **Secure by default** — zod validation on every input, no stack traces leaked, AI keys server-only, webhook keys SHA-256 hashed at rest, login brute-force protection.
- **One-command production** — Docker Compose (MySQL + app) or Vercel Build Output API.

---

## 🧠 How it works

```
  Your API ──1 event per request──▶ API Monitor Dashboard
  (FastAPI / Express)    (webhook)    (live KPIs, charts,
                                      alerts, AI insights)
```

Your API *pushes* telemetry — nothing sits in front of your traffic.
Create an `apk_...` key, drop in one middleware file, and the dashboard
automatically shows failure rate, latency percentiles, endpoint discovery,
and alerts. Limits are enforced atomically at ingest.

---

## 🛠️ Technology

- **Frontend:** React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Recharts
- **Backend:** Hono, Node.js, tRPC (superjson), Drizzle ORM
- **Database:** MySQL 8 (TiDB Cloud Serverless / Aiven free tier compatible — TLS honoured via `ssl-mode`)
- **Auth:** local email/password (scrypt, default) · optional Clerk · optional Supabase
- **AI (optional):** Kimi (Moonshot AI) — server-side only
- **Deploy:** Vercel (Build Output API), Docker, GitHub Actions CI/CD

---

## 📱 Mobile support

Desktop-first, but responsive throughout: the sidebar collapses on small screens, grids stack (KPI cards go 4 → 2 → 1 columns), and tables remain scrollable. The "Open in tab" control escapes preview iframes where partitioned storage can interfere with sessions. Tested down to phone widths.

---

## 🚀 Run locally

**Zero-credential demo** (recommended for trying it):

```bash
npm install
npm run dev          # http://localhost:3000  (Vite + Hono API on one port)
```

Sign in with `demo@example.com` / `demo1234` or create your own account. Data is seeded in-memory and resets on restart. Kimi runs in mock mode automatically.

**With a real persistent database** (TiDB Cloud / Aiven free tier — one command):

```bash
MYSQL_URL="mysql://user:pass@host:4000/db?ssl-mode=REQUIRED" npm run db:setup
npm run dev          # /api/health now reports mode=production
```

**Docker (full stack, MySQL + migrations + app):**

```bash
docker compose up --build   # http://localhost:3000
```

**Scripts worth knowing:** `npm test` (110 offline unit tests), `npm run check` (tsc), `npm run lint`, `npm run db:e2e` (full real-MySQL end-to-end harness). See [Scripts](#scripts) for the rest.

---

## Track your own API (FastAPI / Express)

The tracker records telemetry you push to it — it cannot see traffic it is
not told about. Ready-to-drop middleware for **FastAPI** (Python,
`integrations/fastapi/telemetry.py`) and **Express / Node** (ESM, zero
dependencies, `integrations/express/telemetry.mjs`) stream one event per
served request to the webhook automatically. For a FastAPI app:

```bash
pip install httpx
```

```python
import os
from fastapi import FastAPI
from telemetry import TelemetryMiddleware  # from integrations/fastapi/

app = FastAPI()
app.add_middleware(TelemetryMiddleware)
```

Then set two env vars on your API server (never in the browser):

| Variable | Description |
| --- | --- |
| `TRACKER_URL` | This app's base URL, e.g. `https://tracker.example.com` |
| `TRACKER_API_KEY` | An `apk_...` key created on the **Webhooks** page |

From then on the dashboard automatically shows your API's failure rate,
latency percentiles, endpoints, and (optionally) cost — with per-user
isolation, configured rate limits enforced atomically at ingest, and
email alerts on breach. The middleware is fire-and-forget (adds ~0 ms,
never blocks or breaks your API), forwards only safe headers, and never
logs the key. Optional extras: a `cost_cb` / `costCb` hook for LLM-style per-request
cost and a `check_rate_limit()` / `checkRateLimit()` pre-flight helper.
Express setup is identical with `telemetryMiddleware()` + `TRACKER_URL` /
`TRACKER_API_KEY`. Full guides: `integrations/fastapi/README.md` and
`integrations/express/README.md`.

## Real-time telemetry webhook

External API gateways can push request telemetry **as it happens** — no browser
session required. Create a key on the **Webhooks** page (sidebar), then:

```bash
curl -X POST https://your-app/api/webhook/ingest \
  -H "Authorization: Bearer apk_..." \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"/api/v1/users","method":"GET","statusCode":200,"latencyMs":42}'
```

- Authenticates with a long-lived API key (SHA-256 hashed at rest; the
  plaintext is shown exactly once at creation and can never be recovered).
- Accepts a single event or a batch: `{"events":[...]}` (up to 500).
- Uses the same payload schema, validation, atomic rate-limit enforcement,
  and usage limits as `POST /api/ingest`, so both channels feed the same
  monitoring queries and limits.
- The dashboard polls every 10s, so webhook-streamed telemetry appears live
  without a manual refresh.

**Replay:** the most recent 25 deliveries per account are stored (the exact
validated event payloads, never the bearer keys). On the **Webhooks** page,
**Recent deliveries** lets you re-fire any delivery with one click — useful
after fixing a consumer bug. Replays go through the exact same ingest and
rate-limit path, so an over-limit batch is blocked again (and the replay
itself is recorded as a new delivery).

Replay is also available over the REST API with the same bearer key, e.g. to
re-fire the delivery with id `42` from a gateway script:

```bash
curl -X POST https://your-app/api/webhook/replay/42 \
  -H "Authorization: Bearer apk_..."
# 200 → {"ok":true,"replayId":43,"received":2,"blocked":false}
# 429 → {"ok":false,"blocked":true,...} when the replayed batch is over limit
# 404 → the delivery id does not belong to this key's user
```

## Authentication architecture

Application authentication is **fully separate** from Kimi:

```
User → Clerk, Supabase, or local email/password → authenticated tRPC/API → Dashboard/DB
                                      └── optional Kimi (AI only)
```

### Clerk authentication

When `CLERK_SECRET_KEY` is configured, the server verifies Clerk bearer
session tokens with `@clerk/backend` and links the verified Clerk user to the
local `users` table. The browser uses Clerk's prebuilt React sign-in/sign-up UI
and attaches the short-lived Clerk token to every tRPC request. Run
`npm run db:push` after adding the Clerk column to an existing database.

For this Vite app, add these variables in the Keys tab:

| Variable | Location | Description |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Browser | Clerk publishable key; this is the Vite equivalent of Clerk's `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. |
| `CLERK_SECRET_KEY` | Server | Clerk secret key used only for backend token verification and profile lookup. |

Both keys are required to activate Clerk. If they are absent, the existing
local demo or Supabase path remains active.

- **Local mode (default, zero credentials):** real email/password accounts with
  scrypt-hashed passwords, server-issued session cookies, signup, login, logout,
  and per-user data isolation — backed by an in-memory demo store. The server
  also returns the signed session token in the login response, which the client
  mirrors and sends back as an `Authorization: Bearer` header so the session
  survives preview proxies that strip or rewrite `Set-Cookie` headers.
- **Clerk mode:** when `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` are configured,
  Clerk handles sign-in/sign-up and the backend verifies its bearer tokens.
- **Supabase mode:** when `SUPABASE_URL` + `SUPABASE_ANON_KEY` +
  `SUPABASE_JWT_SECRET` are configured, signup/login/password-reset are handled
  by Supabase Auth. The server verifies the Supabase JWT and issues the same
  application session cookie.
- **Kimi** is never required to sign in. It only powers the optional AI analysis
  endpoint and has three states: `not_connected`, `mock` (deterministic, no API
  calls), and `real` (only when you configure `KIMI_OPEN_URL` + `KIMI_API_KEY`).

Every monitoring route is authenticated and scoped to the signed-in user, so one
account can never read or modify another account's requests, alerts, or metrics.

## Docker (one-command production)

```bash
docker compose up --build
# app → http://localhost:3000
```

The compose stack boots **MySQL 8**, applies the Drizzle migrations via a
one-shot service, and only then starts the production server. A named volume
(`mysql_data`) persists the database across restarts. Set `PORT`, `MYSQL_PASSWORD`,
`MYSQL_ROOT_PASSWORD`, and `APP_SECRET` in a `.env` file for anything other than
local development:

```bash
# .env
APP_SECRET=change-me-to-a-long-random-secret
MYSQL_PASSWORD=dev-password
MYSQL_ROOT_PASSWORD=root-password
```

The runtime image ships only production dependencies and the built bundle; a
commented-out `seed` service in `docker-compose.yml` can optionally provision the
owner admin account (`OWNER_EMAIL` / `OWNER_PASSWORD`).

## FastAPI deployment (Python-first option)

For teams that prefer a Python deployment stack, `server.py` wraps the Hono
backend behind a **FastAPI + uvicorn** process.  The Node server runs as a
managed subprocess; FastAPI proxies `/api/*` to it and serves the built React
SPA directly.

```bash
# 1. Build the frontend + backend first:
npm run build

# 2. Start with FastAPI:
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
# → http://localhost:8000
```

Or via Docker (single image, Python base):

```bash
docker build -f Dockerfile.fastapi -t tracker-fastapi .
docker run -p 8000:8000 tracker-fastapi
```

Or via Docker Compose (MySQL + migrations + FastAPI server):

```bash
docker compose -f docker-compose.fastapi.yml up --build
# → http://localhost:8000
```

**Environment variables** — the same as the Node.js deployment (see
`.env.example`).  The FastAPI server reads `PORT` (default `8000`),
`NODE_INTERNAL_PORT` (default `3001`, internal Node subprocess port), and
`CORS_ORIGINS` (comma-separated allowed origins).

**How it works:** FastAPI spawns `node dist/boot.js` on the internal port,
polls its `/api/health` until healthy, then reverse-proxies every `/api/*`
request to it with streaming.  The React SPA is served from `dist/public/`
via Starlette's `StaticFiles`.  FastAPI's own `/health` endpoint reports
Node subprocess status without depending on it.

## Deploy to Vercel

This repo ships a **Vercel Build Output API** deployment (`vercel.json` +
`scripts/vercel-build.mjs`): `npm run build:vercel` builds the SPA, bundles the
whole Hono API into one catch-all serverless function (`.vercel/output`), and
routes `/api/*` to it with the original path preserved. The root `api/` source
directory would otherwise collide with Vercel's convention that every file
there becomes its own function — the Build Output API avoids that entirely.

**Option A — Git import (recommended):** push this repo to GitHub, then in
Vercel choose *Import Project → fastapi-api-tracker*. Vercel detects
`vercel.json` and runs `npm run build:vercel` on every push/PR; previews are
created for every PR automatically.

**Option B — CLI:**

```bash
npm i -g vercel
vercel deploy
```

**Option C — auto-deploy from GitHub Actions (recommended for real data):**

the `deploy-vercel` job in `.github/workflows/ci.yml` deploys to production on
every push to `main`, **after** lint/typecheck/tests/build all pass. It uses
Vercel's `pull → build --prod → deploy --prebuilt --prod` pattern, so the
serverless artifact CI already built and smoke-tested is uploaded as-is
(Vercel does not rebuild). To enable it, add three **repository secrets**
(Settings → Secrets and variables → Actions → New repository secret):

| Secret | Where to get it |
| --- | --- |
| `VERCEL_TOKEN` | <https://vercel.com/account/tokens> → create a token |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` (or your team dashboard URL) |
| `VERCEL_PROJECT_ID` | same `.vercel/project.json` |

Optionally add `DATABASE_URL`, `DEMO_MODE`, and `APP_SECRET` as secrets too —
they are passed to the CI build so the auto-migrate step can run during the
deploy. Until the secrets exist the `deploy-vercel` job **fails on purpose**
with a clear `::error::` naming the missing secrets — a green “Deploy to
Vercel” check can never be mistaken for a live deployment. (Pull requests
are checked by the separate `pr.yml` workflow, which runs the same quality
and real-MySQL gates but never deploys.)

**One-command activation:** create a token at <https://vercel.com/account/tokens>,
then run `scripts/setup-vercel-deploy.mjs` — it links the project, reads the
org/project IDs from `.vercel/project.json`, and either sets the three
secrets via the `gh` CLI automatically or prints the exact `gh secret set`
commands (and the manual UI path) with your real values ready to paste:

```bash
VERCEL_TOKEN=<token> node scripts/setup-vercel-deploy.mjs
```

On every successful deploy, the job also **reports the production URL back
as a GitHub commit status** (“Vercel Production”), so the deploy result is
visible on the commit — no extra secrets needed (uses the built-in
`GITHUB_TOKEN`).

### Environment variables

Set these in the Vercel project dashboard (**Production** environment):

| Variable | Required | Notes |
| --- | --- | --- |
| `DEMO_MODE=true` | *or* the two below | Runs the app fully in-memory with the seeded demo data — no database needed. Ideal for a live portfolio demo. In-memory data is per-function-instance and resets on cold starts. |
| `DATABASE_URL` | *or* `DEMO_MODE=true` | External MySQL connection string (Drizzle / `mysql2`). Vercel does not host MySQL — use any MySQL provider (see [Free MySQL database](#free-mysql-database)). The app honours `?ssl-mode=` (REQUIRED / VERIFY_CA / VERIFY_IDENTITY / DISABLED) and `?connectionLimit=` from the URL. |
| `APP_SECRET` | Yes (unless demo) | Long random value; signs the session cookie and tokens. |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | Optional | Seeds an admin account. |
| `VITE_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | Optional | Clerk auth. |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_JWT_SECRET` | Optional | Supabase auth. |
| `KIMI_OPEN_URL` + `KIMI_API_KEY` | Optional | Real AI insights. |

With no `DATABASE_URL`, a production deploy **falls back to the in-memory demo
with a loud boot warning** — so a fresh zero-configuration Vercel deploy works
out of the box (previously it crashed with `FUNCTION_INVOCATION_FAILED`). Set
`DEMO_MODE=true` to opt in explicitly, or set `DATABASE_URL` to run against a
real database. A `DATABASE_URL` that is set but unreachable still fails loudly
at query time — it never silently serves demo data.

### How it works on Vercel

- **Static:** `dist/public` is served by Vercel's CDN with an `index.html`
  fallback for SPA client-side routes (`/login`, `/webhooks`, …).
- **API:** every `/api/*` request (tRPC, health, ingest, webhook) is handled by
the single Node.js 22 serverless function; the original URL path is restored
inside `api/vercel.ts` before it reaches Hono.
- `boot.ts` detects Vercel (`VERCEL=1`) and skips starting a long-lived server
  and static file mounting.
- CI builds and smoke-tests the serverless function on every push
  (`scripts/vercel-smoke.mjs`), so a broken Vercel output fails the build
  before you ever deploy.

## Free MySQL database

Vercel doesn't host MySQL, so a real-data deployment needs an external
database. Both options below are genuinely free (no credit card) and work
with this repo out of the box — the app parses the `?ssl-mode=` /
`?connectionLimit=` params straight from the connection string.

**The same connection string drives every layer.** Once you have a
TiDB/Aiven URL, wire it everywhere with one command:

```bash
MYSQL_URL="mysql://user:pass@host:4000/db?ssl-mode=REQUIRED" npm run db:setup
```

That validates the URL, applies the Drizzle migrations (with retry/backoff
for slow-to-wake free instances), and writes a gitignored `.env.local` with
`DATABASE_URL` + a generated `APP_SECRET` — so the local preview
(`npm run dev`) serves **real storage** instead of the in-memory demo
(`/api/health` then reports `mode=production`). To make CI run its real-MySQL
e2e against the **same persistent database** (instead of the ephemeral
`mysql:8.4` service container), add the URL as a `MYSQL_E2E_URL` Actions
secret — the CI job prefers it and falls back to the container when unset.

### TiDB Cloud Serverless (recommended)

MySQL-compatible, **serverless** (scales to zero when idle — no connection
ceiling to manage under Vercel's concurrent lambdas), free tier with ~5 GB
storage, and a first-party **Vercel Marketplace integration** — the database
is provisioned from inside Vercel and `DATABASE_URL` is set automatically.

#### Wire it up through the Vercel Marketplace (zero CLI)

1. Deploy this repo to Vercel first (any way: Git import or `vercel deploy`).
2. In the Vercel project: **Settings → Integrations → Browse** → **TiDB
   Cloud Serverless** → **Add**. Authorize and pick a free Serverless cluster
   (a few minutes to provision).
3. The integration creates the database **and sets `DATABASE_URL` for the
   project automatically** — no env var to paste.
4. Add `APP_SECRET` (Project → Settings → Environment Variables →
   Production: a long random value).
5. **Redeploy** (or push a commit). The Vercel build detects `DATABASE_URL`
   and **applies the Drizzle migrations automatically** (see below), so the
   first deploy already has the schema — no manual step.

#### Manually (or outside Vercel)

1. Sign up at <https://tidbcloud.com> → create a free **Serverless** cluster.
2. In **Connect**, pick *MySQL* → copy the connection string, e.g.:

   ```
   mysql://<user>:<password>@gateway01.<region>.prod.aws.tidbcloud.com:4000/<db>?ssl-mode=REQUIRED
   ```

3. Apply the schema once (from anywhere with network access):

   ```bash
   export DATABASE_URL="<the connection string above>"
   npm run db:migrate:run   # programmatic Drizzle migrator (no CLI prompts)
   npm run db:seed          # optional: seed the first user with 1500 demo rows
   ```

4. Set the same `DATABASE_URL` (plus `APP_SECRET`) in Vercel → Deploy.

**Automatic migrations on deploy:** when the Vercel build sees `DATABASE_URL`
(and `DEMO_MODE` is not `true`), it runs `scripts/migrate.ts` before
assembling the output — a fresh database is migrated on the very first
deploy, and later schema changes apply on the next push. A failed migration
**aborts the build**, so a schema-less deploy never ships. Set
`SKIP_DB_MIGRATE=1` if you run migrations from a separate pipeline.
`npm run db:migrate:run` runs the same migrator manually.

TiDB requires TLS — keep `?ssl-mode=REQUIRED` in the URL.

### Aiven for MySQL (free tier)

A genuine MySQL 8, always-free: 1 GB storage, 1 GB RAM, 1 CPU, backups.
TLS is mandatory and free instances cap at **76 concurrent connections**,
so keep the pool small for serverless concurrency (`?connectionLimit=3`
below). Free services may power down after inactivity and wake on demand.

1. Sign up at <https://aiven.io> → **Create service** → *MySQL* → **Free** plan.
2. From the service overview, copy the connection string, e.g.:

   ```
   mysql://avnadmin:<password>@<host>.aivencloud.com:13306/defaultdb?ssl-mode=REQUIRED&connectionLimit=3
   ```

3. Run `npm run db:migrate` with that `DATABASE_URL`, then set it in Vercel.

## Continuous integration (GitHub Actions)

Two workflows run automatically on this repository:

- **`.github/workflows/ci.yml`** — on every push to `main`/`master`:
  `npm ci` → `tsc -b` → eslint → vitest → production build → **Vercel output
  build + serverless-function smoke test** → in-process smoke-boot of the
  production bundle → **real-MySQL end-to-end** (boots a `mysql:8.4` service,
  applies the migrations, registers a user, seeds 1500 rows, verifies
  percentiles, ingests webhook telemetry and confirms it persisted) → pushes
  the Docker image to GHCR → deploys to Vercel.
- **`.github/workflows/pr.yml`** (PR Checks) — on every pull request: the
  same quality gates and real-MySQL e2e, without any deploys.

The MySQL job is what catches SQL bugs the in-memory demo-store unit tests
can't — e.g. the p95 window-function query or timestamp precision. It also
proves **rate-limit hardening**: it configures a hard daily limit, fires a
burst of concurrent webhook ingests against the real database, and asserts
exactly the allowed number pass (no over-counting under the row-lock
transaction). By default it runs against an ephemeral `mysql:8.4` service
container; set a `MYSQL_E2E_URL` Actions secret (TiDB Cloud / Aiven free
tier — see [Free MySQL database](#free-mysql-database)) and CI runs the e2e
against that **persistent** database instead, and the job summary says which
storage each run used.

On every push to `main`, an additional **`deploy-vercel`** job (see
[Deploy to Vercel](#deploy-to-vercel)) builds the production output and
deploys it to Vercel with `--prebuilt` — gated on the quality job and
skipped until the `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`
secrets are configured.

## Database setup

```bash
npm run db:generate
npm run db:migrate
# or
npm run db:push
npm run db:seed                  # requires at least one application user
SEED_USER_ID=123 npm run db:seed # target a specific existing user
```

The SQL seed script always assigns rows to an existing application user. It
fails closed when no user exists, rather than creating rows with an unusable
`user_id=0` that no authenticated account could read.

## Environment variables

Create a `.env` file (see the table). Nothing is required to start the app —
with no variables set it runs the zero-credential local demo.

### Required for production

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes (production) | MySQL connection string (Drizzle / `mysql2`). When unset the app runs in demo mode. |
| `APP_SECRET` | Yes (production) | Secret used to sign the application session cookie (HS256). Use a long random value. |

After changing the schema, run `npm run db:push` (or `db:generate` + `db:migrate`)
against your production database.

### Owner account (admin)

Set **both** to seed your personal administrator account (used in demo mode and
by `npm run db:seed`). The password is hashed in memory and never written to disk
or sent to the browser.

| Variable | Required | Description |
| --- | --- | --- |
| `OWNER_EMAIL` | Optional | Your login email (granted the `admin` role). |
| `OWNER_PASSWORD` | Optional | Your login password for that email. |

### Optional — Clerk Auth

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Optional | Browser-safe Clerk publishable key for this Vite app. |
| `CLERK_SECRET_KEY` | Optional | Server-only Clerk secret key. |

### Optional — Supabase Auth

Set **all three** to switch application authentication to Supabase:

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | Optional | Your Supabase project URL. |
| `SUPABASE_ANON_KEY` | Optional | Supabase publishable anon key (safe for the browser). |
| `SUPABASE_JWT_SECRET` | Optional | Supabase project JWT secret (server-side only). |
| `VITE_SUPABASE_URL` | Optional | Browser-exposed copy of `SUPABASE_URL` (public). |
| `VITE_SUPABASE_ANON_KEY` | Optional | Browser-exposed copy of `SUPABASE_ANON_KEY` (public). |

Supabase's free plan includes 50,000 monthly active users, a 500 MB database,
and unlimited API requests — no credit card required.

### Optional — Kimi (AI only)

| Variable | Required | Description |
| --- | --- | --- |
| `KIMI_OPEN_URL` | Optional | Kimi Open API origin. When set together with the key, real AI analysis is enabled. |
| `KIMI_API_KEY` | Optional | Server-side Kimi API key. Never exposed to the browser. |

Without these, Kimi reports `not_connected` (or `mock` in demo mode) and the
core application is unaffected.

## Scripts

```bash
npm run dev          # Vite dev server + Hono API (http://localhost:3000)
npm run build        # vite build + bundle the API (dist/)
npm run build:vercel # npm run build + assemble .vercel/output (Vercel deploy)
npm run start        # run the production server (node dist/boot.js)
npm test             # vitest (offline, no external services)
npm run lint         # eslint
npm run check        # tsc -b
npm run db:generate  # generate a new migration from db/schema.ts (offline)
npm run db:migrate   # apply committed migrations (db/migrations/*) to MySQL
npm run db:migrate:run # programmatic migrator (retries transient DB errors; used by the Vercel build)
npm run db:push      # push the Drizzle schema directly to MySQL
npm run db:verify    # run real Drizzle queries against MySQL to prove the prod data path
npm run db:seed      # seed the first user (or SEED_USER_ID=<id>) with demo telemetry
npm run db:e2e       # full real-MySQL e2e (ephemeral MySQL; or MYSQL_E2E_URL=...)
npm run db:setup     # one-command persistent DB wiring (MYSQL_URL=... validates, migrates, writes .env.local)
```

## Project structure

```text
├── api/                  # Hono bootstrap, tRPC routers, auth, queries, demo store
│   └── vercel.ts         # Vercel serverless entry (path reconstruction)
├── contracts/            # Shared constants and errors
├── db/                   # Drizzle schema, relations, seed script
├── docs/screenshots/     # README screenshots (captured from the running app)
├── integrations/         # Ready-to-drop client SDKs (FastAPI + Express telemetry middleware)
├── scripts/              # start-preview.sh, vercel-build.mjs, vercel-smoke.mjs, migrate.ts, setup-vercel-deploy.mjs
├── src/                  # React frontend (pages, components, providers)
├── drizzle.config.ts     # Drizzle config
├── vercel.json           # Vercel build config (Build Output API)
├── vite.config.ts        # Vite config
├── vitest.config.ts      # Test config
└── package.json          # Scripts and dependencies
```

## Security hardening

This section documents the security posture of the app and the checks that
are enforced in code and CI.

### Row-level isolation (RLS-equivalent)

MySQL has no native row-level security, so isolation is enforced at the
**query layer**: every monitoring query, limit, alert, and webhook key is
scoped by the authenticated `user_id`, and webhook keys are scoped to the
account that created them (replaying another user's delivery → `404`). One
account can never read, modify, or delete another account's data — this is
covered by multi-user isolation tests and by the real-MySQL e2e harness.

### Secrets and environment

- `.env`, `.env.*`, `.env.local`, `*.pem`, `*.key` are gitignored; nothing
  secret is ever committed. `.env.example` documents every variable with
  placeholder values only.
- Server secrets (`APP_SECRET`, `CLERK_SECRET_KEY`, `SUPABASE_JWT_SECRET`,
  `KIMI_API_KEY`, `RESEND_API_KEY`) exist only server-side, never in
  `VITE_*` variables.
- The webhook API key is **SHA-256 hashed at rest**; the plaintext is shown
  exactly once at creation and can never be recovered.
- **AI keys are never in the frontend.** Kimi runs entirely server-side
  (`KIMI_OPEN_URL` + `KIMI_API_KEY`); the browser only receives a status
  string (`real` / `mock` / `not_connected`).

### Error hygiene — no stack traces to clients

- A global Hono `onError` handler logs the full error server-side and
  returns a generic `{"error":"Internal Server Error"}` to the client.
- The tRPC layer is explicitly server-side (`isServer: true`) and tRPC
  strips stack traces from client responses when `NODE_ENV=production`.
  Errors are logged to the server console for debugging.
- Client-side failure suggestions never echo internal paths or stacks.

### Admin and debug lockdown

- There are **no public admin or debug endpoints**: unknown `/api/*` routes
  return `404`, the only unauthenticated routes are sign-in/sign-up/auth
  config/health/ping, and `/api/health` returns no data.
- An `adminQuery` middleware exists for future admin-only procedures and
  requires the `admin` role (`FORBIDDEN` otherwise); the owner account
  (`OWNER_EMAIL`) is the only way to hold that role today.

### Input validation and rate limiting

- **Every user input is validated with zod** (register, login, limits,
  webhooks, monitoring filters, ingest payloads) — bounded lengths, typed
  ranges, and `max(500)` batch caps; oversized bodies are rejected with
  `413` before touching the body stream.
- **Credential brute-force protection**: a fixed-window in-memory rate
  limiter blocks repeated failed logins and reports `Retry-After`.
- **Usage/rate limits are enforced atomically** at ingest (row-lock
  transaction — concurrent bursts cannot over-count) and are proven in CI
  against real MySQL.

### Logging and tracking hygiene

- Server logs never print request bodies, bearer tokens, or API keys; the
  e2e harness deliberately truncates keys in its output.
- Telemetry stored by the tracker is the payload the API chose to send;
  the middleware docs (see [Track your own FastAPI API](#track-your-own-api-fastapi--express))
  only forward an allowlisted subset of headers.

## Security notes

- Never commit a real `.env` file — `.env*` is gitignored.
- Server secrets (`APP_SECRET`, `CLERK_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `KIMI_API_KEY`) are
  server-only and never placed in `VITE_*` variables.
- Only intentionally public values (`VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
  are exposed to the browser.
- Authentication and authorization are enforced server-side in every route.
- The client mirrors the signed session token in `localStorage` and sends it as
  an `Authorization: Bearer` header. This is a signed HS256 JWT (not a raw
  credential) and is only meaningful alongside the rest of the session; the
  httpOnly cookie remains the primary channel when it is available.

## Contributing

This is a personal project maintained with a strict CI bar (typecheck, lint,
110+ tests, real-MySQL e2e). PRs welcome — open one and the `pr.yml` workflow
checks it automatically. Keep changes focused, add tests for new behavior,
and never commit `.env` files or secrets. See the CI section above for what
runs on every push.
