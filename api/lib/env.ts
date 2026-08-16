import "dotenv/config";
import { config as loadEnvFile } from "dotenv";

// Also load the platform-managed local env file (where the Keys/API Keys tab
// writes values via freebuff-env). `dotenv/config` above only reads `.env`.
// `.env.local` is gitignored, so these values never reach version control.
loadEnvFile({ path: ".env.local" });

function required(name: string): string {
  return process.env[name] ?? "";
}

/**
 * Local-only secret used to sign session JWTs when neither APP_SECRET nor a
 * Supabase JWT secret is configured (i.e. zero-credential local demo mode).
 * This is deliberately not a production secret.
 */
const DEMO_SESSION_SECRET =
  "local-demo-only-session-secret-do-not-use-in-production";

const isProduction = process.env.NODE_ENV === "production";
const forceDemo = process.env.DEMO_MODE === "true";
const databaseUrl = required("DATABASE_URL");
const supabaseUrl = required("SUPABASE_URL");
const supabaseAnonKey = required("SUPABASE_ANON_KEY");
const supabaseJwtSecret = required("SUPABASE_JWT_SECRET");
const clerkSecretKey = required("CLERK_SECRET_KEY");

if (isProduction && !forceDemo && !databaseUrl) {
  throw new Error("DATABASE_URL is required in production; set DEMO_MODE=true to run the in-memory demo in production");
}
if (isProduction && !forceDemo && !required("APP_SECRET")) {
  throw new Error("APP_SECRET is required in production");
}

export const env = {
  isProduction,
  databaseUrl,
  /**
   * Demo mode is active when DATABASE_URL is unset or DEMO_MODE=true.
   * The app then serves seeded in-memory data instead of MySQL and uses a
   * local email/password auth backed by the in-memory store. DEMO_MODE=true
   * works even with NODE_ENV=production so a hosted (e.g. Vercel) demo
   * deployment can run without a database.
   */
  isDemoMode: forceDemo || (!isProduction && !databaseUrl),

  /**
   * Clerk Auth is enabled when the server secret is configured. The browser
   * side gates its Clerk UI on VITE_CLERK_PUBLISHABLE_KEY, which is a
   * client-only variable and never reaches this server process.
   */
  isClerkMode: Boolean(clerkSecretKey),
  clerkSecretKey,

  /** Supabase Auth is only used when all three are configured. */
  isSupabaseMode: Boolean(supabaseUrl && supabaseAnonKey && supabaseJwtSecret),
  supabaseUrl,
  supabaseAnonKey,
  supabaseJwtSecret,

  /** Signs the application session cookie. */
  sessionSecret:
    required("APP_SECRET") ||
    (forceDemo ? DEMO_SESSION_SECRET : !isProduction ? supabaseJwtSecret || DEMO_SESSION_SECRET : ""),

  /** Optional: email of the deployment owner (granted the admin role). */
  ownerEmail: (process.env.OWNER_EMAIL ?? "").toLowerCase(),

  /**
   * Optional: password for the owner's local email/password account. Used
   * together with OWNER_EMAIL to seed an admin account in demo mode (and by
   * the seed script). Server-only — never exposed to the browser or git.
   */
  ownerPassword: required("OWNER_PASSWORD"),

  // ─── Kimi (OPTIONAL — AI features only, never required to sign in) ────
  kimiOpenUrl: required("KIMI_OPEN_URL"),
  kimiApiKey: required("KIMI_API_KEY"),

  // ─── Email notifications (OPTIONAL — usage-limit alerts) ──────────────
  resendApiKey: required("RESEND_API_KEY"),
  resendFrom: required("RESEND_FROM"),
  appUrl: required("APP_URL"),
};
