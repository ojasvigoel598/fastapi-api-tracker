import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    // Standard MySQL via mysql2. The legacy "planetscale" mode existed for
    // PlanetScale's serverless driver (it disabled lateral subqueries), but
    // PlanetScale discontinued its MySQL hosting, so a real MySQL instance
    // uses the default mode.
    instance = drizzle(env.databaseUrl, {
      mode: "default",
      schema: fullSchema,
    });
  }
  return instance;
}
