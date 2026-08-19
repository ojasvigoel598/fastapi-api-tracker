# API Monitoring & Admin Dashboard

![CI](https://github.com/ojasvigoel598/fastapi-api-tracker/actions/workflows/ci.yml/badge.svg)
![PR Checks](https://github.com/ojasvigoel598/fastapi-api-tracker/actions/workflows/pr.yml/badge.svg)
[![Docker](https://ghcr-badge.egpl.dev/ojasvigoel598/fastapi-api-tracker/latest_tag?label=docker&color=%2344cc11)](https://github.com/ojasvigoel598/fastapi-api-tracker/pkgs/container/fastapi-api-tracker)
[![Docker pulls](https://ghcr-badge.elias.eu.org/shield/ojasvigoel598/fastapi-api-tracker)](https://github.com/ojasvigoel598/fastapi-api-tracker/pkgs/container/fastapi-api-tracker)
[![Docker size](https://ghcr-badge.egpl.dev/ojasvigoel598/fastapi-api-tracker/size?tag=latest&label=image%20size&color=%2344cc11)](https://github.com/ojasvigoel598/fastapi-api-tracker/pkgs/container/fastapi-api-tracker)

A full-stack API monitoring dashboard: request logs, analytics charts, endpoints,
alerts, and AI-assisted insights.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Hono, Node.js, tRPC
- Database: MySQL + Drizzle ORM
- Authentication: **Clerk** (optional) + email/password (local) + optional Supabase Auth
- AI (optional): Kimi (Moonshot AI)

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
transaction).

On every push to `main`, an additional **`deploy-vercel`** job (see
[Deploy to Vercel](#deploy-to-vercel)) builds the production output and
deploys it to Vercel with `--prebuilt` — gated on the quality job and
skipped until the `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`
secrets are configured.

## Zero-credential local demo

No API keys, no database, no external services required:

```bash
npm install
npm run dev     # http://localhost:3000
```

Open the app and either **create an account** or sign in with the seeded demo
account:

- email: `demo@example.com`
- password: `demo1234`

Each new account gets its own seeded monitoring dataset, so multi-user isolation
is exercised offline. Kimi runs in mock mode automatically. Data resets on every
restart.

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
```

## Preview recovery & sandbox recycling

The app is **IP-agnostic**: the frontend calls the backend on the **same origin**
(relative `/api/trpc`), and the dev server binds to `0.0.0.0`. Nothing stores or
depends on a temporary container IP, so a recycled sandbox (new container/IP)
works as soon as the process comes back up.

- `GET /api/health` — unauthenticated readiness probe (no database, no external
  calls). Safe for the preview proxy and load balancers to poll.
- The SPA polls `/api/health`; if the backend disappears it shows a
  "Connection lost — reconnecting…" banner and retries with **exponential
  backoff** (1s → 2s → 4s … capped at 30s), then reconnects automatically when
  the backend returns — no manual refresh required.

### Sign-in across the preview iframe and tabs

Sign-in no longer depends on a single cookie. On login the server:

1. Sets an httpOnly `app_sid` cookie whose flags match the request context:
   - `SameSite=Lax` for same-origin / top-level tab access (the common case).
   - `SameSite=None` only for a genuine cross-site iframe.
   - `Secure` only when the request actually arrives over HTTPS
     (`x-forwarded-proto: https`). Marking a cookie `Secure` while serving over
     plain HTTP makes browsers silently drop it — the original cause of the
     "sign in, then immediately back to sign-in" loop.
   - It never uses the `Partitioned` (CHIPS) attribute, which scopes a cookie to
     the embedding top-level site and makes it disappear when the app is opened
     in its own tab.
2. Also returns the signed session token in the login response body. The client
   stores it and sends it as `Authorization: Bearer <token>` on every request,
   so the session survives preview proxies that strip or rewrite `Set-Cookie`
   headers.

An **“Open in tab”** control (on the login screen, the sign-in prompt, and the
sidebar) opens the app in a fresh browser tab — escaping the preview iframe
where third-party cookie/storage partitioning can otherwise interfere with the
session.

### Automatic restart after sandbox recycles

The sandbox periodically recycles its container, which kills the foreground
dev process — this is what makes the preview proxy return
`502 proxy upstream error` until something restarts the app. To recover
without manual intervention:

- `scripts/start-preview.sh` is a boot-time supervisor: it waits for the
  project directory, checks `GET /api/health`, and runs `npm run dev`
  (Vite + Hono API on port 3000) only when nothing is already serving the
  port. It restarts the server again if it ever crashes.
- The sandbox's `start-services.sh` invokes that supervisor on every boot, so
  the dashboard comes back on its own after each recycle.

`start-services.sh` lives in the sandbox image rather than this repository. On
a fresh sandbox that is missing the hook, add this line before its `exit 0`:

```sh
(sh "/home/daytona/codebase/scripts/start-preview.sh" >/tmp/freebuff-preview-supervisor.log 2>&1 &)
```

### Data persistence across restarts

- **Demo mode** (no `DATABASE_URL`): data lives in memory and is re-seeded on
  every start, so it resets when the sandbox recycles. This is intentional and
  labelled in the UI.
- **Production** (`DATABASE_URL` set): all data lives in external MySQL and
  survives sandbox recycles because the database is outside the container.

The preview sandbox lifecycle (start/stop/recycle and the proxy's
container-IP resolution) is managed by the Freebuff platform, not by this
repository. With the boot-time supervisor above in place the app restarts
itself after a recycle; if a fresh sandbox lacks the hook, restart the preview
from the platform (`freebuff-preview restart` where the CLI is available) — the
app itself starts cleanly with no leftover-state dependency.

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

## Proof / Verification

Verified against the live Freebuff preview on 2026-08-15. The sandbox runs in
zero-credential demo mode (no `DATABASE_URL`), so the seeded demo account is
`demo@example.com` / `demo1234`. The preview URL is ephemeral (it changes per
sandbox); the one used below was
`https://3000-0008bce4-0e49-48b5-a7a9-9fa3418ea097.daytonaproxy01.net`.

| # | Check | Result |
| --- | --- | --- |
| 1 | Typecheck — `npm run check` | ✅ passed (no errors) |
| 2 | Test suite — `npm test` | ✅ 54 passed (9 files) |
| 3 | Readiness probe — `GET /api/health` | ✅ `200` `{"ok":true,"mode":"demo"}` |
| 4 | Sign in — `POST /api/trpc/auth.login` | ✅ `200`, `set-cookie: app_sid=…; HttpOnly; Secure; SameSite=Lax`, body contains the signed `token` |
| 5 | Session via cookie — `GET /api/trpc/auth.me` | ✅ `200`, returns `demo@example.com` |
| 6 | Session via bearer token (no cookie) — `GET /api/trpc/auth.me` with `Authorization: Bearer <token>` | ✅ `200`, returns `demo@example.com` |
| 7 | Frontend serves — `GET /` | ✅ Vite dev `index.html` with `/src/main.tsx` |

The automated suite additionally covers (offline, no external services): the
login → session-cookie → `auth.me` flow, bearer-token authentication, multi-user
data isolation, `/api/ingest` telemetry, webhook API-key create/list/revoke and
single/batch ingest with 401/400 enforcement, the failure-history endpoint (30
failures by default with pagination), and usage-limit thresholds, resets,
duplicate-alert suppression, and hard-limit enforcement.

Latency percentiles (p50/p95/p99) are computed in MySQL with window functions
(nearest-rank), and the overview p95 is computed in SQL instead of downloading
every row — both stay constant-memory at any volume.

**Screenshots** were not captured in this environment because the sandbox has no
browser tooling, and the managed preview proxy is controlled by Freebuff (it
recycles the sandbox independently of this repository). To reproduce visually:
run `npm install && npm run dev`, open `http://localhost:3000`, sign in with the
demo account, and confirm the Dashboard shows the KPI cards, charts, alerts, and
recent failures.

## Project structure

```text
├── api/                  # Hono bootstrap, tRPC routers, auth, queries, demo store
│   └── vercel.ts         # Vercel serverless entry (path reconstruction)
├── contracts/            # Shared constants and errors
├── db/                   # Drizzle schema, relations, seed script
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
  the middleware docs (see [Track your own FastAPI API](#track-your-own-fastapi-api))
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
