import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a transient Supabase client used only to sign in/up and obtain an
 * access token. Session persistence is handled by the application's own
 * httpOnly cookie, so we disable Supabase's local session storage.
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
