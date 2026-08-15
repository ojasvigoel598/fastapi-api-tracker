# API Monitoring & Admin Dashboard

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
  and per-user data isolation — backed by an in-memory demo store.
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
| `OWNER_EMAIL` | Optional | Email granted the `admin` role on sign-in. |

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
npm run start        # run the production server (node dist/boot.js)
npm test             # vitest (offline, no external services)
npm run lint         # eslint
npm run check        # tsc -b
npm run db:push      # push the Drizzle schema to MySQL
npm run db:seed      # seed the first user (or SEED_USER_ID=<id>) with demo telemetry
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

### Data persistence across restarts

- **Demo mode** (no `DATABASE_URL`): data lives in memory and is re-seeded on
  every start, so it resets when the sandbox recycles. This is intentional and
  labelled in the UI.
- **Production** (`DATABASE_URL` set): all data lives in external MySQL and
  survives sandbox recycles because the database is outside the container.

The preview sandbox lifecycle (start/stop/recycle and the proxy's
container-IP resolution) is managed by the Freebuff platform, not by this
repository. If the preview proxy reports "failed to resolve container IP",
restart the preview from the platform (`freebuff-preview restart` where the CLI
is available) — the app itself starts cleanly with no leftover-state dependency.

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

## Project structure

```text
├── api/                  # Hono bootstrap, tRPC routers, auth, queries, demo store
├── contracts/            # Shared constants and errors
├── db/                   # Drizzle schema, relations, seed script
├── src/                  # React frontend (pages, components, providers)
├── drizzle.config.ts     # Drizzle config
├── vite.config.ts        # Vite config
├── vitest.config.ts      # Test config
└── package.json          # Scripts and dependencies
```

## Security notes

- Never commit a real `.env` file — `.env*` is gitignored.
- Server secrets (`APP_SECRET`, `CLERK_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `KIMI_API_KEY`) are
  server-only and never placed in `VITE_*` variables.
- Only intentionally public values (`VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
  are exposed to the browser.
- Authentication and authorization are enforced server-side in every route.
