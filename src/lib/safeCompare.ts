import crypto from 'crypto';

// Constant-time string comparison — used for any secret-bearing value compared
// against user input (access tokens, the cron shared secret), matching the
// precedent already set by lib/ticketCode.ts's signature check. A remote timing
// attack over HTTP against a JS string compare is not realistically exploitable
// here (both values are full-entropy), but this keeps the codebase consistent
// and costs nothing.
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
