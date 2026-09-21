import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signJwt, verifyJwt, authCookieOptions } from './auth';

describe('password hashing', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
  });
});

describe('JWT helpers', () => {
  const secret = 'test-secret-value';

  it('round-trips a valid token', () => {
    const token = signJwt({ id: 'user-1' }, secret);
    expect(verifyJwt(token, secret)).toEqual({ id: 'user-1' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signJwt({ id: 'user-1' }, secret);
    expect(verifyJwt(token, 'other-secret')).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    expect(() => verifyJwt('not-a-jwt', secret)).not.toThrow();
    expect(verifyJwt('not-a-jwt', secret)).toBeNull();
  });
});

describe('authCookieOptions', () => {
  it('uses SameSite=Lax without Secure outside production (localhost dev over HTTP)', () => {
    const options = authCookieOptions();
    expect(options.sameSite).toBe('lax');
    expect(options.secure).toBeFalsy();
  });
});
