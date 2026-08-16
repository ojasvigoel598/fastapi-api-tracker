# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────
# Stage 1 — dependencies (used by the app and by the one-shot migrate
# service, which needs the full dev toolchain for drizzle-kit)
# ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────────────
# Stage 2 — build (vite SPA → dist/public, esbuild API bundle → dist/)
# ─────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────
# Stage 3 — production runtime (dependencies only, no build tooling)
# ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["npm", "start"]
