import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type { User } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";
import * as demoStore from "../demo/store";

export type NewUserInput = {
  email: string;
  name: string | null;
  passwordHash?: string;
  passwordSalt?: string;
  supabaseId?: string;
  clerkId?: string;
  avatar?: string | null;
  role?: "user" | "admin";
};

export async function findUserById(id: number): Promise<User | undefined> {
  if (env.isDemoMode) return demoStore.findUserById(id);
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows.at(0);
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  if (env.isDemoMode) return demoStore.findUserByEmail(email);
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return rows.at(0);
}

export async function findUserBySupabaseId(
  supabaseId: string,
): Promise<User | undefined> {
  if (env.isDemoMode) return demoStore.findUserBySupabaseId(supabaseId);
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.supabaseId, supabaseId))
    .limit(1);
  return rows.at(0);
}

export async function findUserByClerkId(
  clerkId: string,
): Promise<User | undefined> {
  if (env.isDemoMode) return demoStore.findUserByClerkId(clerkId);
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);
  return rows.at(0);
}

export async function createUser(input: NewUserInput): Promise<User> {
  if (env.isDemoMode) return demoStore.createUser(input);

  const [result] = await getDb()
    .insert(schema.users)
    .values({
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      supabaseId: input.supabaseId,
      clerkId: input.clerkId,
      avatar: input.avatar,
      role: input.role ?? "user",
      lastSignInAt: new Date(),
    })
    .$returningId();

  const user = await findUserById(result.id);
  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function upsertClerkUser(
  clerkId: string,
  email: string,
  name: string | null,
  avatar: string | null,
): Promise<User> {
  const normalizedEmail = email.toLowerCase();
  const role = normalizedEmail && normalizedEmail === env.ownerEmail ? "admin" : "user";

  if (env.isDemoMode) {
    return demoStore.upsertClerkUser(clerkId, normalizedEmail, name, avatar, role);
  }

  const byClerk = await findUserByClerkId(clerkId);
  if (byClerk) {
    await getDb()
      .update(schema.users)
      .set({
        email: normalizedEmail || byClerk.email,
        name: name ?? byClerk.name,
        avatar,
        role: byClerk.role === "admin" ? "admin" : role,
        lastSignInAt: new Date(),
      })
      .where(eq(schema.users.id, byClerk.id));
    return (await findUserById(byClerk.id)) as User;
  }

  const byEmail = normalizedEmail ? await findUserByEmail(normalizedEmail) : undefined;
  if (byEmail) {
    await getDb()
      .update(schema.users)
      .set({
        clerkId,
        name: name ?? byEmail.name,
        avatar,
        role: byEmail.role === "admin" ? "admin" : role,
        lastSignInAt: new Date(),
      })
      .where(eq(schema.users.id, byEmail.id));
    return (await findUserById(byEmail.id)) as User;
  }

  return createUser({
    email: normalizedEmail || `user-${clerkId.slice(0, 8)}@clerk.local`,
    name,
    clerkId,
    avatar,
    role,
  });
}

export async function updateLastSignIn(id: number): Promise<void> {
  if (env.isDemoMode) {
    demoStore.updateLastSignIn(id);
    return;
  }
  await getDb()
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, id));
}

export async function setUserPassword(
  id: number,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  if (env.isDemoMode) {
    demoStore.setUserPassword(id, passwordHash, passwordSalt);
    return;
  }
  await getDb()
    .update(schema.users)
    .set({ passwordHash, passwordSalt })
    .where(eq(schema.users.id, id));
}

/**
 * Invalidate all previously issued session tokens by bumping the user's
 * token version. Logout and password changes call this so stolen tokens die
 * immediately instead of living out their 7-day lifetime.
 */
export async function bumpTokenVersion(id: number): Promise<void> {
  if (env.isDemoMode) {
    demoStore.bumpTokenVersion(id);
    return;
  }
  await getDb()
    .update(schema.users)
    .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
    .where(eq(schema.users.id, id));
}

/**
 * Find or create the local user for a verified Supabase identity (`sub`).
 * Links an existing email/password account to Supabase when the emails match.
 */
export async function upsertSupabaseUser(
  supabaseId: string,
  email: string,
): Promise<User> {
  const normalizedEmail = email.toLowerCase();
  const role =
    normalizedEmail && normalizedEmail === env.ownerEmail ? "admin" : "user";

  if (env.isDemoMode) {
    return demoStore.upsertSupabaseUser(supabaseId, normalizedEmail, role);
  }

  const bySupabase = await findUserBySupabaseId(supabaseId);
  if (bySupabase) {
    await getDb()
      .update(schema.users)
      .set({
        email: normalizedEmail || bySupabase.email,
        role: bySupabase.role === "admin" ? "admin" : role,
        lastSignInAt: new Date(),
      })
      .where(eq(schema.users.id, bySupabase.id));
    return (await findUserById(bySupabase.id)) as User;
  }

  const byEmail = normalizedEmail
    ? await findUserByEmail(normalizedEmail)
    : undefined;
  if (byEmail) {
    await getDb()
      .update(schema.users)
      .set({
        supabaseId,
        role: byEmail.role === "admin" ? "admin" : role,
        lastSignInAt: new Date(),
      })
      .where(eq(schema.users.id, byEmail.id));
    return (await findUserById(byEmail.id)) as User;
  }

  return createUser({
    email: normalizedEmail || `user-${supabaseId.slice(0, 8)}@anonymous.local`,
    name: null,
    supabaseId,
    role,
  });
}
