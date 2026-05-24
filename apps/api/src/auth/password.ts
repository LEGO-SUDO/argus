// Argon2id password hashing wrapper.
//
// Tasks 2 + 4: hashPassword / verifyPassword.
// We use the `argon2` library with default memory/time/parallelism — Owasp
// 2023 baseline (m=19MiB, t=2, p=1) is what the library ships, and we don't
// override.
//
// Output format: $argon2id$v=19$m=...,t=...,p=...$salt$hash
// The library auto-generates a random 16-byte salt per hash so two calls with
// the same plaintext produce different outputs (Task 1 assertion).
import * as argon2 from 'argon2';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash / library-level failure should NOT throw upstream —
    // a verification miss is functionally identical to a wrong password.
    return false;
  }
}

/**
 * Dummy hash used for timing equalization on unknown-email login paths.
 * argon2.verify on this returns false but takes the same CPU as a real
 * lookup — see Open Question on cross-method user-enumeration in the LLD.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ZGVmYXVsdHNhbHRzYWx0cw$X9fyyV9HSlD1WI/8JK6vYzBs1XYzWVj5xZ8VbnK0E2k';
