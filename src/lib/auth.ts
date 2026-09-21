import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { CookieOptions } from 'express';
import { env } from '../env';

const SALT_ROUNDS = 10;

// Shared by both auth cookie routes (Tasks 6, 8). In production the frontend
// and API are on different registrable domains, so a cross-site
// credentials:'include' request needs SameSite=None + Secure — a plain
// SameSite=Lax cookie is silently dropped on cross-site requests by every
// modern browser. Locally, frontend/backend share `localhost` (different
// ports only), which still counts as same-site, so Lax without Secure works
// for HTTP dev without needing a certificate.
export function authCookieOptions(): CookieOptions {
  return env.nodeEnv === 'production'
    ? { httpOnly: true, sameSite: 'none', secure: true }
    : { httpOnly: true, sameSite: 'lax' };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signJwt(payload: { id: string }, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

export function verifyJwt(token: string, secret: string): { id: string } | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'object' && decoded !== null && 'id' in decoded) {
      return { id: (decoded as { id: string }).id };
    }
    return null;
  } catch {
    return null;
  }
}
