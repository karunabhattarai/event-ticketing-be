import { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../env';

// The routers these limiters attach to (organizerAuthRouter, buyerAuthRouter,
// orderStatusRouter, organizerOrdersRouter) are module-level singletons built
// once at import time and reused across every createApp() call — including
// the ~100+ test cases, each of which calls createApp() fresh via testApp()
// but ends up sharing the *same* router/middleware instances. express-rate-
// limit's default in-memory store is keyed per-middleware-instance, not
// per-Express-app, so a limiter built once here and attached to those shared
// routers would accumulate hits across unrelated tests and produce spurious
// 429s. Restructuring the routers to be built fresh inside createApp() (so a
// fresh limiter could be constructed per app) would mean threading every
// router through a factory function instead of a module-level export — a
// much larger change than this fix warrants. Instead, gate to a no-op
// passthrough under NODE_ENV=test: rate limiting exists to shape production
// traffic patterns (bcrypt CPU exhaustion, unlimited outbound email), not to
// isolate per-test-run state, so skipping it in tests doesn't weaken what
// the fix is protecting against. The limiter's own behavior (that it *does*
// block past its limit) is covered by a dedicated unit test that mounts it
// standalone, independent of this gate.
// Gate on process.env.VITEST rather than env.nodeEnv === 'test': this repo's
// .env.test deliberately sets NODE_ENV=development (other code, e.g.
// lib/auth.ts's cookie-secure flag, branches on nodeEnv === 'production' vs.
// not, and .env.test intentionally exercises the "not production" path
// without claiming to be a distinct 'test' env) — so env.nodeEnv is never
// actually 'test' when `npx dotenv -e .env.test -- vitest run` runs.
// process.env.VITEST is set unconditionally by the vitest runner itself,
// independent of whatever NODE_ENV a given .env file configures.
function buildLimiter(options: Parameters<typeof rateLimit>[0]): RequestHandler {
  if (env.nodeEnv === 'test' || process.env.VITEST) {
    return (_req, _res, next) => next();
  }
  return rateLimit(options);
}

// Login/register: bcrypt at cost 10 means each request costs real CPU time —
// unthrottled, this is a CPU-exhaustion DoS vector as much as a brute-force one.
export const authRateLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Resend: anyone holding one access token (or, for the organizer route, anyone who
// owns the event) can otherwise trigger unlimited outbound email with attachments.
export const resendRateLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
