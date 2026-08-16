import "dotenv/config";
import { config as loadEnvFile } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Also load the platform-managed local env file (the Keys/API Keys tab writes
// values there via freebuff-env), mirroring api/lib/env.ts. `dotenv/config`
// above only reads `.env`, so DATABASE_URL set through the Keys tab would
// otherwise be invisible to db:generate / db:migrate / db:push.
loadEnvFile({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});
