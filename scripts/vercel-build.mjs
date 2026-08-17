/**
 * Assembles the Vercel Build Output API artifacts (.vercel/output).
 *
 * Run after the regular production build (vite SPA -> dist/public and the
 * esbuild server bundle -> dist/boot.js); `npm run build:vercel` does both.
 *
 * Layout produced:
 *   .vercel/output/static/                 -> SPA (index.html + assets)
 *   .vercel/output/functions/api.func/     -> catch-all serverless function
 *     index.mjs                              (bundled Hono app, see api/vercel.ts)
 *     .vc-config.json
 *   .vercel/output/config.json             -> routing
 *
 * Routing: every `/api/*` request is rewritten to the function with the
 * original path passed as the `vercelPath` query param (api/vercel.ts
 * restores it). Static files are served from the CDN; anything else falls
 * back to index.html so SPA deep links work.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, ".vercel", "output");
const funcDir = path.join(outRoot, "functions", "api.func");
const staticDir = path.join(outRoot, "static");

// 0) Apply pending DB migrations when a real database is configured. A
//    freshly-provisioned TiDB/Aiven database has zero tables, so running the
//    Drizzle migrations here makes the first deploy "just work". Skipped for
//    demo deployments (no DATABASE_URL or DEMO_MODE=true) and in CI (which
//    does not set DATABASE_URL). Set SKIP_DB_MIGRATE=1 to disable when you
//    run migrations from a separate pipeline. A failed migration aborts the
//    build so a schema-less deploy never ships.
if (
  process.env.SKIP_DB_MIGRATE !== "1" &&
  process.env.DATABASE_URL &&
  process.env.DEMO_MODE !== "true"
) {
  console.log("[vercel] DATABASE_URL present — applying pending Drizzle migrations…");
  try {
    execSync("npx --no-install tsx scripts/migrate.ts", {
      stdio: "inherit",
      cwd: root,
    });
    console.log("[vercel] migrations OK");
  } catch {
    console.error(
      "[vercel] migration failed — aborting build so a schema-less deploy never ships",
    );
    process.exit(1);
  }
} else {
  console.log("[vercel] skipping DB migrations (demo mode or no DATABASE_URL)");
}

await rm(outRoot, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });

// 1) Bundle the Hono app into a single ESM function file. Mirrors the server
//    build in package.json (same banner so CJS deps can `require`).
await build({
  entryPoints: [path.join(root, "api", "vercel.ts")],
  outfile: path.join(funcDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: path.join(root, "tsconfig.json"),
  banner: {
    js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

// 2) Function metadata (Node.js runtime; named GET/POST/... exports are the
//    Web-standard Vercel Functions API).
await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      supportsResponseStreaming: true,
    },
    null,
    2,
  ),
);

// 3) Static SPA output.
await cp(path.join(root, "dist", "public"), staticDir, { recursive: true });

// 4) Deployment routing.
await writeFile(
  path.join(outRoot, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // All /api/* traffic -> the single catch-all function. The original
        // path is captured so api/vercel.ts can reconstruct the URL.
        { src: "^/api(/.*)?$", dest: "/api?vercelPath=$1" },
        // Serve built static assets from the CDN first...
        { handle: "filesystem" },
        // ...then fall back to index.html for SPA client-side routes.
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log(`[vercel] Build Output API artifacts written to ${outRoot}`);
