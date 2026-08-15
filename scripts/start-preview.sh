#!/bin/bash
# Boot-time supervisor for the API Monitor preview (Vite + Hono API).
#
# The Freebuff/Daytona sandbox periodically recycles its container, which kills
# the foreground dev server and leaves the preview proxy returning 502. This
# script is invoked by the sandbox's start-services.sh on every boot and keeps
# `npm run dev` running on port 3000, so the dashboard recovers automatically
# after each recycle.
set -u

PROJECT_DIR="/home/daytona/codebase"
PORT=3000
HEALTH_URL="http://localhost:${PORT}/api/health"
LOG="/tmp/freebuff-preview.log"

if ! cd "$PROJECT_DIR" 2>/dev/null; then
  echo "[preview-supervisor] project dir not ready: $PROJECT_DIR" >> "$LOG"
  exit 1
fi

# Ensure commits are attributed to the project owner's GitHub account. The
# platform occasionally re-injects its noreply address into the local git
# config on reconnect, so re-assert the intended identity on every boot.
git config user.name "Ojasvi Goel" 2>/dev/null || true
git config user.email "ojasvigoel598@gmail.com" 2>/dev/null || true

# If something is already serving the port (for example the platform's own
# managed preview process), do nothing — avoid a port conflict.
if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

# Keep the dev server alive across crashes and sandbox recycles.
while true; do
  if ! curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[preview-supervisor] starting dev server at $(date -Is)" >> "$LOG"
    npm run dev >> "$LOG" 2>&1
    echo "[preview-supervisor] dev server stopped at $(date -Is)" >> "$LOG"
  fi
  sleep 5
done
