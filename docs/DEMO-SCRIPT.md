# API Monitor — Demo Video Script

A scene-by-scene guide for recording a 2–3 minute hackathon demo video.
Each scene includes what to show, what to say (voiceover or caption), and
the exact steps to perform on screen.

**Total target length:** 90–150 seconds.

---

## Scene 1 — The Problem (10 seconds)

**What to show:** A terminal running `curl` commands against a generic API,
with errors silently happening — no visibility into what's failing.

**Voiceover / caption:**
> "When your API breaks, you find out from your users. There's no dashboard,
> no alerts, no way to see failure rates or latency spikes in real time."

**Steps:**
1. Open a terminal.
2. Run a few `curl` commands against a fake endpoint (some succeed, some 500).
3. Highlight: no feedback, no monitoring, no idea what's happening.

---

## Scene 2 — The Solution: API Monitor (5 seconds)

**What to show:** The README hero image or a clean title card.

**Voiceover / caption:**
> "API Monitor is a real-time dashboard that tracks your API's requests,
> failure rates, latency, and endpoints — with alerts and AI insights.
> Run it in 30 seconds, wire it in 5."

---

## Scene 3 — Zero-Config Start (15 seconds)

**What to show:** Terminal → browser → login → dashboard appears.

**Steps:**
1. In terminal: `npm install && npm run dev`
2. Open `http://localhost:3000` in browser.
3. On the login screen, click **"Use demo account"** (one click, no signup).
4. Dashboard loads instantly — KPI cards, charts, insights, all populated.

**Voiceover / caption:**
> "No API keys, no database, no signup. One click and you're in."

---

## Scene 4 — The Dashboard (15 seconds)

**What to show:** The dashboard with live data.

**Steps:**
1. Hover over the KPI cards: Total Requests, Failure Rate, Avg Latency, Active Endpoints.
2. Point at the request-volume chart (time series).
3. Point at the status-code breakdown.
4. Scroll down to show: AI Insights, Top Endpoints, Active Alerts, Recent Failures.

**Voiceover / caption:**
> "Every metric is live: total requests, failure rate, latency percentiles,
> endpoint discovery, and AI-powered insights — all from a single dashboard."

---

## Scene 5 — Pushing Real Telemetry (20 seconds)

**What to show:** The webhook integration — the core value proposition.

**Steps:**
1. Navigate to **Webhooks** page.
2. Click **"Create key"** — copy the `apk_...` token.
3. In terminal, paste the `curl` command from the README:
   ```bash
   curl -X POST http://localhost:3000/api/webhook/ingest \
     -H "Authorization: Bearer apk_..." \
     -H "Content-Type: application/json" \
     -d '{"endpoint":"/api/v1/users","method":"GET","statusCode":200,"latencyMs":42}'
   ```
4. Run it 3–5 times with different `statusCode` values (200, 201, 500).
5. Navigate back to **Dashboard** — the new requests appear within 10 seconds.
6. Point at the updated failure rate and the new endpoint in "Top Endpoints."

**Voiceover / caption:**
> "Create a key, push events from any API — the dashboard updates live.
> Failure rates, latency percentiles, endpoint discovery — all automatic."

---

## Scene 6 — Alerts & Limits (15 seconds)

**What to show:** Proactive monitoring features.

**Steps:**
1. Navigate to **Limits** → set a daily cap on an endpoint (e.g., 10 requests).
2. In terminal, fire a burst of webhook events past the limit.
3. Show: requests beyond the limit are blocked with `429`.
4. Navigate to **Dashboard** → show the blocked count.
5. Navigate to **Alerts** → show the triggered alert.

**Voiceover / caption:**
> "Set hard limits per endpoint. Over-limit requests are blocked atomically.
> Alerts fire automatically when thresholds are breached."

---

## Scene 7 — Analytics Deep Dive (15 seconds)

**What to show:** The analytics page with real data.

**Steps:**
1. Navigate to **Analytics**.
2. Show: request volume chart, failure rate over time, latency distribution.
3. Switch time range (24h → 7d → 30d).
4. Navigate to **Endpoints** → show p50/p95/p99 percentiles per endpoint.

**Voiceover / caption:**
> "Latency percentiles, status-code distributions, time-range filtering —
> all computed from your real telemetry."

---

## Scene 8 — Multi-User Isolation (10 seconds)

**What to show:** Security and data isolation.

**Steps:**
1. Navigate to **Webhooks** → show the key is scoped to this account.
2. Briefly mention: "Every row is scoped to the signed-in user.
   One account can never read another's data."

**Voiceover / caption:**
> "Full multi-user isolation. Webhook keys are SHA-256 hashed at rest.
   Auth, rate limiting, and input validation are enforced server-side."

---

## Scene 9 — Integration (10 seconds)

**What to show:** Ready-to-drop middleware for real APIs.

**Steps:**
1. Open `integrations/fastapi/telemetry.py` in the editor.
2. Show the 3-line setup:
   ```python
   from telemetry import TelemetryMiddleware
   app.add_middleware(TelemetryMiddleware)
   ```
3. Show the Express equivalent (`integrations/express/telemetry.mjs`).

**Voiceover / caption:**
> "Drop in one file for FastAPI or Express. Every request is tracked
> automatically — fire-and-forget, zero overhead."

---

## Scene 10 — Close (5 seconds)

**What to show:** The dashboard one more time, or a title card.

**Voiceover / caption:**
> "API Monitor: real-time API monitoring in 30 seconds.
> Open source. Production-ready. Link in the description."

---

## Recording Tips

- **Resolution:** 1920×1080 or 1440×900.
- **Browser:** Chrome, no extensions visible, clean profile.
- **Terminal:** Dark theme, large font, no personal info visible.
- **Speed:** Type commands at a moderate pace; pause briefly after each action.
- **Mouse:** Move smoothly, don't jitter. Use the cursor highlighter if available.
- **Audio:** Record voiceover separately if possible (cleaner than live mic).
- **Editing:** Cut dead time between scenes. Use brief crossfades.
- **Captions:** Use burned-in subtitles for key statements — NOT captions on every screenshot.

## What NOT to Do

- Don't put large text blocks over screenshots.
- Don't narrate every button click ("now I click here, now I scroll here").
- Don't show the login process for more than 3 seconds.
- Don't show error messages or loading spinners.
- Don't show the terminal and browser simultaneously (full-screen each one).
- Don't rush — 2 minutes is better than 90 seconds of chaos.
