import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export interface PasswordHash {
  salt: string;
  hash: string;
}

/**
 * Hash a password with scrypt and a random per-user salt.
 * The salt is stored separately so it can be rotated independently of the row.
 */
export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { salt, hash };
}

/**
 * Constant-time verification of a password against a stored salt/hash.
 */
export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): boolean {
  try {
    const actual = scryptSync(password, salt, KEY_LENGTH);
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
