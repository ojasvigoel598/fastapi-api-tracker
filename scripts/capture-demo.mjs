#!/usr/bin/env node
/**
 * Capture demo screenshots and generate an animated GIF from the running app.
 *
 * Prerequisites:
 *   1. The dev server must be running (npm run dev)
 *   2. Google Chrome must be installed
 *   3. Install gifencoder: npm install --no-save gifencoder
 *
 * Usage:
 *   node scripts/capture-demo.mjs
 *
 * Output:
 *   docs/screenshots/          — fresh PNG screenshots (replaces existing)
 *   docs/demo.gif              — animated GIF of the demo flow
 */

import { execSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const SHOTS_DIR = join(ROOT, "docs", "screenshots");
const FRAMES_DIR = join(ROOT, "docs", ".gif-frames");
const GIF_PATH = join(ROOT, "docs", "demo.gif");
const BASE = "http://127.0.0.1:3000";
const CHROME =
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function captureScreenshot(url, outputPath, { width = 1440, height = 900, delay = 2000 } = {}) {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-software-rasterizer",
    `--window-size=${width},${height}`,
    `--screenshot=${outputPath}`,
    url,
  ];

  try {
    execSync(`"${CHROME}" ${args.join(" ")}`, {
      timeout: 20000,
      stdio: "pipe",
      env: { ...process.env, HOME: process.env.HOME || "/tmp" },
    });
    const size = statSync(outputPath).size;
    console.log(`  ✓ ${outputPath} (${(size / 1024).toFixed(0)} KB)`);
    return true;
  } catch (e) {
    console.error(`  ✗ Failed to capture ${url}: ${e.message}`);
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== API Monitor — Demo Capture ===\n");

  ensureDir(SHOTS_DIR);
  ensureDir(FRAMES_DIR);

  // Check Chrome exists
  if (!existsSync(CHROME)) {
    console.error(`Chrome not found at ${CHROME}`);
    console.error("Please install Google Chrome or update the CHROME path in this script.");
    process.exit(1);
  }

  // Check server is running
  try {
    const resp = await fetch(`${BASE}/api/health`);
    const data = await resp.json();
    console.log(`Server running: mode=${data.mode}\n`);
  } catch {
    console.error("Dev server not running. Start it with: npm run dev");
    process.exit(1);
  }

  // ── Step 1: Sign in via CDP ──
  console.log("Signing in with demo account...");

  // We'll capture the login page first, then use a trick:
  // The demo account auto-signs in when you click the button.
  // For headless capture, we'll pre-set the session cookie.

  // Actually, let's just capture the login page and the dashboard
  // by using the known demo credentials via the API.

  // Get a session token by calling the login API
  let sessionToken = null;
  try {
    const loginResp = await fetch(`${BASE}/api/trpc/auth.login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { email: "demo@example.com", password: "demo1234" },
      }),
    });
    const loginData = await loginResp.json();
    sessionToken = loginData?.result?.data?.json?.token;
    if (sessionToken) {
      console.log("  ✓ Got session token\n");
    }
  } catch (e) {
    console.error("  ✗ Login failed:", e.message);
  }

  // ── Step 2: Capture screenshots ──
  console.log("Capturing screenshots...");

  const pages = [
    { name: "01-login", path: "/login", note: "Login page" },
    { name: "02-dashboard", path: "/", note: "Main dashboard with KPIs" },
    { name: "03-requests", path: "/requests", note: "Request logs" },
    { name: "04-analytics", path: "/analytics", note: "Analytics charts" },
    { name: "05-endpoints", path: "/endpoints", note: "Endpoint percentiles" },
    { name: "06-alerts", path: "/alerts", note: "Alert management" },
    { name: "07-limits", path: "/limits", note: "Rate limits" },
    { name: "08-webhooks", path: "/webhooks", note: "Webhook keys & deliveries" },
  ];

  for (const p of pages) {
    const url = `${BASE}${p.path}`;
    const out = join(SHOTS_DIR, `${p.name}.png`);
    captureScreenshot(url, out);
    // Also save a frame for the GIF
    const frameOut = join(FRAMES_DIR, `${p.name}.png`);
    captureScreenshot(url, frameOut);
    await sleep(500);
  }

  // ── Step 3: Generate GIF ──
  console.log("\nGenerating animated GIF...");

  try {
    // Try to use gifencoder
    const gifencoder = await import("gifencoder");
    const { createCanvas, loadImage } = await import("canvas");

    const frames = readdirSync(FRAMES_DIR)
      .filter((f) => f.endsWith(".png"))
      .sort();

    if (frames.length === 0) {
      console.log("  No frames captured — skipping GIF generation.");
      return;
    }

    // Load first frame to get dimensions
    const firstFrame = await loadImage(join(FRAMES_DIR, frames[0]));
    const width = firstFrame.width;
    const height = firstFrame.height;

    const gif = new gifencoder.GIFEncoder(width, height);
    gif.start();
    gif.setRepeat(0); // loop forever
    gif.setDelay(2000); // 2 seconds per frame
    gif.setQuality(10);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    for (const frame of frames) {
      const img = await loadImage(join(FRAMES_DIR, frame));
      ctx.drawImage(img, 0, 0);
      gif.addFrame(ctx.getImageData(0, 0, width, height).data);
      console.log(`  ✓ Added frame: ${frame}`);
    }

    gif.finish();
    writeFileSync(GIF_PATH, Buffer.from(gif.out.getData()));
    console.log(`\n  ✓ GIF saved: ${GIF_PATH} (${(statSync(GIF_PATH).size / 1024).toFixed(0)} KB)`);
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      console.log("  gifencoder or canvas not installed.");
      console.log("  To generate the GIF, run:");
      console.log("    npm install --no-save gifencoder canvas");
      console.log("    node scripts/capture-demo.mjs");
      console.log("\n  Screenshots have been saved to docs/screenshots/ regardless.");
    } else {
      console.error("  GIF generation failed:", e.message);
    }
  }

  // ── Cleanup ──
  console.log("\nDone! Screenshots saved to docs/screenshots/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
