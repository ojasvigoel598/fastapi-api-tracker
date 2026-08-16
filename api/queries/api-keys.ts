/**
 * Webhook API Key data layer.
 *
 * Keys are long-lived credentials for real-time telemetry ingest
 * (`POST /api/webhook/ingest`). Only a SHA-256 hash of each key is stored;
 * the plaintext is returned exactly once at creation time.
 *
 * Demo mode keeps keys in memory (mirroring api/demo/store.ts); the
 * MySQL/Drizzle path is used whenever DATABASE_URL is configured.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { env } from "../lib/env";
import { apiKeys, type ApiKey } from "@db/schema";

const KEY_PREFIX = "apk_";

export type ApiKeyWithUsage = Pick<
  ApiKey,
  "id" | "name" | "keyHint" | "lastUsedAt" | "createdAt"
>;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new plaintext key with a `apk_` prefix and 32 random bytes. */
export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

// ─── Demo-mode in-memory store ────────────────────────────────────────

let demoKeys: (ApiKey & { userId: number })[] = [];
let nextDemoKeyId = 1;

function demoListFor(userId: number): ApiKeyWithUsage[] {
  return demoKeys
    .filter((k) => k.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((k) => ({
      id: k.id,
      name: k.name,
      keyHint: k.keyHint,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
}

// ─── Lookup (used by the webhook handler) ─────────────────────────────

/**
 * Resolve a plaintext bearer key to the owning user id, or undefined when
 * the key is unknown. The plaintext is hashed and matched, never compared
 * in the clear.
 */
export async function findUserByApiKey(
  key: string,
): Promise<{ userId: number; keyId: number } | undefined> {
  const keyHash = hashKey(key);
  if (env.isDemoMode) {
    const row = demoKeys.find((k) => k.keyHash === keyHash);
    return row ? { userId: row.userId, keyId: row.id } : undefined;
  }
  const db = getDb();
  const rows = await db
    .select({ userId: apiKeys.userId, keyId: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  const row = rows.at(0);
  return row ? { userId: row.userId, keyId: row.keyId } : undefined;
}

/** Touch `last_used_at` after a successful webhook ingest. */
export async function touchApiKey(keyId: number): Promise<void> {
  if (env.isDemoMode) {
    const row = demoKeys.find((k) => k.id === keyId);
    if (row) row.lastUsedAt = new Date();
    return;
  }
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyId));
}

// ─── Key management (tRPC, signed-in user) ────────────────────────────

/**
 * Create a key and return the plaintext exactly once. The caller must
 * surface it immediately — it cannot be recovered afterwards.
 */
export async function createApiKey(
  userId: number,
  name: string,
): Promise<{ key: string; record: ApiKeyWithUsage }> {
  const key = generateApiKey();
  const now = new Date();
  const row = {
    keyHash: hashKey(key),
    keyHint: key.slice(-4),
    lastUsedAt: null,
  };

  if (env.isDemoMode) {
    const record: ApiKey & { userId: number } = {
      id: nextDemoKeyId++,
      userId,
      name,
      ...row,
      createdAt: now,
    };
    demoKeys.push(record);
    return {
      key,
      record: {
        id: record.id,
        name: record.name,
        keyHint: record.keyHint,
        lastUsedAt: record.lastUsedAt,
        createdAt: record.createdAt,
      },
    };
  }

  const db = getDb();
  const [result] = await db
    .insert(apiKeys)
    .values({ userId, name, ...row })
    .$returningId();
  const created = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, result.id),
  });
  if (!created) throw new Error("Failed to create API key");
  return {
    key,
    record: {
      id: created.id,
      name: created.name,
      keyHint: created.keyHint,
      lastUsedAt: created.lastUsedAt,
      createdAt: created.createdAt,
    },
  };
}

export async function listApiKeys(userId: number): Promise<ApiKeyWithUsage[]> {
  if (env.isDemoMode) return demoListFor(userId);
  const db = getDb();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((k) => ({
      id: k.id,
      name: k.name,
      keyHint: k.keyHint,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
}

export async function revokeApiKey(
  userId: number,
  keyId: number,
): Promise<void> {
  if (env.isDemoMode) {
    demoKeys = demoKeys.filter((k) => !(k.id === keyId && k.userId === userId));
    return;
  }
  const db = getDb();
  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
}
