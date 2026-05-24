// Tasks 1+3 (RED) / 2+4 (GREEN) — argon2id wrapper.
import { hashPassword, verifyPassword } from '../../src/auth/password';

describe('password (argon2id)', () => {
  it('hashPassword produces an argon2id-formatted string', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('hashPassword salts so two calls on the same plaintext yield different outputs', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a).not.toBe(b);
  });

  it('verifyPassword returns true for matching plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('verifyPassword returns false for mismatched plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('verifyPassword returns false on malformed hash (does not throw)', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
