import { useEffect, useRef, useState } from "react";

/**
 * Detects when the backend becomes unreachable (e.g. the managed sandbox was
 * recycled and the app process is restarting) and shows a reconnecting state.
 *
 * Behaviour:
 *  - Polls the same-origin `/api/health` endpoint (never a hard-coded host or
 *    container IP), so it works regardless of which container the proxy routes
 *    to.
 *  - When healthy, polls slowly (liveness only).
 *  - When down, retries with exponential backoff (1s → 2s → 4s … capped at 30s)
 *    so it never hammers the proxy, then reconnects automatically.
 *  - After recovery it briefly shows a "Reconnected" confirmation and hides.
 */

type Status = "up" | "down" | "recovered";

const HEALTH_URL = "/api/health";
const HEALTHY_POLL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

export default function ReconnectBanner() {
  const [status, setStatus] = useState<Status>("up");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let backoff = 1_000;

    const check = async () => {
      let ok = false;
      try {
        const res = await fetch(HEALTH_URL, { cache: "no-store" });
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (cancelled) return;

      if (ok) {
        backoff = 1_000;
        setStatus((prev) => (prev === "down" ? "recovered" : "up"));
        timer.current = window.setTimeout(check, HEALTHY_POLL_MS);
      } else {
        setStatus("down");
        timer.current = window.setTimeout(check, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    };

    void check();

    return () => {
      cancelled = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  // After recovering, show a brief confirmation then hide the banner.
  useEffect(() => {
    if (status !== "recovered") return;
    const t = window.setTimeout(() => setStatus("up"), 4_000);
    return () => window.clearTimeout(t);
  }, [status]);

  if (status === "up") return null;

  const isDown = status === "down";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium shadow-md ${
        isDown
          ? "bg-destructive text-destructive-foreground"
          : "bg-emerald-600 text-white"
      }`}
    >
      <span
        className={`inline-block size-2 rounded-full ${
          isDown ? "animate-pulse bg-white" : "bg-white"
        }`}
        aria-hidden="true"
      />
      {isDown
        ? "Connection lost — reconnecting automatically…"
        : "Reconnected"}
    </div>
  );
}
