import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts", "scripts/**/*.test.ts"],
    // Password hashing (scrypt) in the auth/integration tests is intentionally
    // slow; 5s per test is too tight on slower machines and in CI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
