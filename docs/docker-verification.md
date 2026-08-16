# Docker stack — live verification checklist

This checklist verifies the one-command production stack
(`docker compose up --build`) end to end. It was written because Docker is
not available on the development machine where CI was authored; the CI
deploy job (`.github/workflows/ci.yml`) already performs a **real build of
the Dockerfile** on every push to `main` — this checklist covers the
parts only a local Docker daemon can exercise (compose orchestration,
MySQL persistence, and the running container).

## Prerequisites

- Docker Engine + Docker Compose v2 (`docker compose version`)
- Port 3000 free, or set `PORT` in `.env`

## 1. One-command boot

```bash
docker compose up --build -d
```

Expected (verify with `docker compose ps` and `docker compose logs -f`):

| Service | Expected |
| --- | --- |
| `mysql` | healthy (healthcheck green) |
| `migrate` | runs once, exits `0`, logs `[✓] ... done` |
| `app` | healthy, `depends_on` satisfied |

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"
```

**Check:** all three services reach `running`/`healthy` (migrate exits).

## 2. Health probe

```bash
curl -sf http://localhost:3000/api/health
```

Expected: `{"ok":true,"mode":"production","time":...}` — note **`mode: "production"`**,
proving `DATABASE_URL` + `APP_SECRET` were picked up from the environment
(not demo mode).

## 3. Sign-up and sign-in

- Open `http://localhost:3000`, create an account (or use the seeded owner
  account if you uncommented the `seed` service).
- Sign out, sign back in — the session must survive a reload.

**Check:** `users` table row exists:

```bash
docker compose exec mysql mysql -u api_monitor -p"$MYSQL_PASSWORD" api_monitor -e "SELECT id, email, role FROM users;"
```

## 4. Webhook ingest through the container

Grab a session token, create an API key, and push telemetry — the whole
flow must work against the containerized app:

```bash
TOKEN=$(curl -sf -X POST http://localhost:3000/api/trpc/auth.login \
  -H "content-type: application/json" \
  -d '{"json":{"email":"demo@example.com","password":"demo1234"}}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).result.data.json.token))")

KEY=$(curl -sf -X POST http://localhost:3000/api/trpc/webhooks.createKey \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"json":{"name":"container-check"}}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).result.data.json.key))")

curl -sf -X POST http://localhost:3000/api/webhook/ingest \
  -H "authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"endpoint":"/container-check","method":"GET","statusCode":200,"latencyMs":42}'
```

Expected: `201` and `{"ok":true,"received":[...]}`.

**Check:** the row is in MySQL (not just in memory):

```bash
docker compose exec mysql mysql -u api_monitor -p"$MYSQL_PASSWORD" api_monitor \
  -e "SELECT endpoint, status_code, latency_ms FROM api_requests WHERE endpoint='/container-check';"
```

## 5. Data persistence across restart

```bash
docker compose down          # stops containers (volume survives)
docker compose up -d         # no --build needed
```

**Check:** the webhook row from step 4 is still queryable in the dashboard
or via `SELECT COUNT(*) FROM api_requests WHERE endpoint='/container-check';`
→ `1`. If it is gone, the MySQL volume is not being persisted.

A full teardown (deletes data) is deliberately separate:

```bash
docker compose down -v       # -v removes the mysql_data volume
```

## 6. Migration idempotency

Restarting `migrate` against an already-migrated database must be a no-op:

```bash
docker compose run --rm migrate
```

Expected: exits `0`, reports no new migrations applied.

## 7. Secrets hygiene

```bash
docker compose config | grep -c "MYSQL_ROOT_PASSWORD"   # > 0
git check-ignore .env                                    # .env must be ignored
```

**Check:** no secret values appear in `docker compose config` output beyond
the ones you set in `.env` (compose interpolates them — never hardcode them
in `docker-compose.yml`).

## 8. Production mode guard

```bash
docker compose exec app sh -c 'echo $NODE_ENV'    # → production
```

A misconfigured stack must **fail closed** (no DATABASE_URL → app refuses to
start rather than silently running in demo mode against production data).

## Troubleshooting

- **`migrate` fails to connect** → MySQL not healthy yet; `docker compose up`
  waits on the healthcheck, but `docker compose run` bypasses ordering —
  retry, or check `docker compose logs mysql` for auth errors.
- **App 500s on `/api/health`** → `APP_SECRET` too short/weak; HS256 needs a
  sufficient key. Use a long random value.
- **Port conflict** → set `PORT` in `.env` and rebuild/restart the app
  service only: `docker compose up -d app`.

## CI already covers (no local Docker needed)

- Typecheck, lint, 42-test suite, production build, in-process smoke test
  of the bundle (`quality` job).
- **Real Dockerfile build + GHCR publish** on every push to `main`
  (`deploy` job) — `ghcr.io/<owner>/fastapi-api-tracker:latest` and `:<sha>`.
