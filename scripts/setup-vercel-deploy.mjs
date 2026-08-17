#!/usr/bin/env node
/**
 * One-command activation of the GitHub Actions -> Vercel deploy pipeline.
 *
 * Wires the three repository secrets the `deploy-vercel` CI job needs:
 *   VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
 *
 * Usage:
 *   VERCEL_TOKEN=<token> node scripts/setup-vercel-deploy.mjs
 *
 * The only thing you must create yourself is the Vercel token:
 * https://vercel.com/account/tokens -> Create Token (scope: full, or at
 * least "Deployment" + "Project" read/write). Tokens are minted in the
 * Vercel dashboard and cannot be created from a script.
 *
 * What this does:
 *   1. `vercel link` (npx, no global install) — creates or associates the
 *      Vercel project and writes .vercel/project.json with the IDs.
 *   2. Reads VERCEL_ORG_ID + VERCEL_PROJECT_ID from that file.
 *   3. If the `gh` CLI is installed and authenticated, sets the three
 *      repository secrets automatically.
 *   4. Otherwise prints the exact `gh secret set` commands (or the manual
 *      GitHub UI path) with the real values ready to paste.
 *
 * Idempotent: safe to re-run; `vercel link` and `gh secret set` both
 * overwrite cleanly.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("VERCEL_TOKEN is required (create it at https://vercel.com/account/tokens).");
  process.exit(1);
}

const repo = "ojasvigoel598/fastapi-api-tracker";

console.log("[setup-vercel] linking Vercel project (npx vercel link --yes)…");
try {
  execSync("npx --yes vercel link --yes", {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, VERCEL_TOKEN: token },
  });
} catch {
  console.error("vercel link failed. Is the token valid? Does it have project access?");
  process.exit(1);
}

let projectJson;
try {
  projectJson = JSON.parse(readFileSync(path.join(root, ".vercel", "project.json"), "utf8"));
} catch {
  console.error(".vercel/project.json not found after link — something went wrong.");
  process.exit(1);
}

const orgId = projectJson.orgId;
const projectId = projectJson.projectId;
if (!orgId || !projectId) {
  console.error(".vercel/project.json is missing orgId/projectId.");
  process.exit(1);
}
console.log(`[setup-vercel] project linked: orgId=${orgId} projectId=${projectId}`);

// ── Auto-set via gh CLI when available ────────────────────────────────
let ghAvailable = false;
try {
  execSync("gh --version", { stdio: "ignore" });
  ghAvailable = true;
} catch {
  /* not installed */
}

if (ghAvailable) {
  console.log("[setup-vercel] gh CLI found — setting repository secrets…");
  for (const [name, value] of [
    ["VERCEL_TOKEN", token],
    ["VERCEL_ORG_ID", orgId],
    ["VERCEL_PROJECT_ID", projectId],
  ]) {
    execSync(`gh secret set ${name} --repo ${repo} --body "${value}"`, {
      stdio: "inherit",
      cwd: root,
    });
  }
  console.log("[setup-vercel] done — the deploy-vercel CI job will deploy on the next push to main.");
  process.exit(0);
}

// ── Print exact commands/values for manual setup ──────────────────────
console.log(`
[setup-vercel] gh CLI not found — set the three secrets manually.

Option A — GitHub CLI (recommended):
  gh secret set VERCEL_TOKEN --repo ${repo}
  gh secret set VERCEL_ORG_ID --repo ${repo}
  gh secret set VERCEL_PROJECT_ID --repo ${repo}

Option B — GitHub web UI:
  ${repo} -> Settings -> Secrets and variables -> Actions -> New repository secret

  Name: VERCEL_TOKEN     Value: ${token.slice(0, 6)}… (paste the full token)
  Name: VERCEL_ORG_ID    Value: ${orgId}
  Name: VERCEL_PROJECT_ID Value: ${projectId}

Optional (real-data deploys run the build-time auto-migrate):
  Name: DATABASE_URL     Value: <your MySQL connection string>
  Name: APP_SECRET       Value: <long random value>
  Name: DEMO_MODE        Value: true   (only when running the zero-database demo)

After the secrets are set, push any commit to main and the deploy-vercel job
will deploy to production.`);
