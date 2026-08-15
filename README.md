# API Monitoring & Admin Dashboard

Status: Ongoing / in development. This project may contain bugs, incomplete features, and rough edges. It is being published for progress tracking and continued iteration.

## Overview

This project is a full-stack monitoring dashboard for APIs and auth flows. It includes:

- React + TypeScript frontend built with Vite
- Hono backend with tRPC endpoints
- MySQL persistence via Drizzle ORM
- OAuth login integration with Kimi
- Monitoring pages for requests, analytics, alerts, and endpoints
- Admin/auth flows for project users

## Current state

This repository is intentionally being published before the project is fully finished. Some features may be incomplete, unstable, or require additional configuration.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Hono, Node.js, tRPC
- Database: MySQL + Drizzle
- Auth: Kimi OAuth / JWT session handling

## Project structure

```text
app/
├── api/                  # Backend API, routers, auth, env, and Hono bootstrap
├── contracts/            # Shared contract types/constants
├── db/                  # Database schema and migrations
├── src/                 # Frontend app and pages
├── .env.example         # Environment template for required values
├── .gitignore           # Sensitive and build exclusions
├── components.json      # shadcn component configuration
├── drizzle.config.ts    # Drizzle config
├── eslint.config.js     # Lint config
├── index.html           # Vite entry
├── package.json         # Scripts and dependencies
├── tsconfig*.json       # TypeScript config
├── vite.config.ts       # Vite configuration
├── vitest.config.ts     # Test config
└── README.md            # This file
```

## Prerequisites

- Node.js 20+
- npm
- MySQL database
- Kimi OAuth credentials / app configuration

## Setup

1. Copy the sample environment file:

```bash
cp .env.example .env
```

2. Fill in the required values in `.env`:

- `APP_ID`
- `APP_SECRET`
- `DATABASE_URL`
- `KIMI_AUTH_URL`
- `KIMI_OPEN_URL`
- `OWNER_UNION_ID`
- `VITE_KIMI_AUTH_URL`
- `VITE_APP_ID`

3. Install dependencies:

```bash
npm install
```

4. Run the development server:

```bash
npm run dev
```

5. Build the app:

```bash
npm run build
```

## Database setup

This project expects a MySQL database and uses Drizzle for schema management:

```bash
npm run db:generate
npm run db:migrate
```

You may also use:

```bash
npm run db:push
```

## Notes on secrets and publishing

- Do not commit a real `.env` file.
- Keep `.env` values local only.
- Only `.env.example` should be tracked, with placeholder values.
- Review the repo diff before pushing to verify no API keys, tokens, or credentials remain.

## Development notes

This project was published as a working snapshot for continued development. Expect bugs, missing polish, or partial implementations while it is being iterated on.

## License

No explicit license file is included at this time. If you intend to publish this publicly, confirm the appropriate license before distribution.

