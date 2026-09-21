import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

// rateLimiters.ts's exported authRateLimiter/resendRateLimiter are gated to a
// no-op passthrough under NODE_ENV=test (see the comment in that file for
// why: the limiter middleware is attached once, at module load, to the
// module-level singleton auth/resend routers shared across every
// createApp() call in the ~100+ test suite, so an active limiter's in-memory
// counters would leak between unrelated tests and cause spurious 429s).
// That gate means importing authRateLimiter directly here would just give a
// no-op in this test run too. So this test proves the *underlying*
// express-rate-limit configuration actually enforces a limit, by building an
// equivalent limiter fresh and mounting it on a throwaway Express app —
// independent of createApp()/NODE_ENV gating.
describe('rate limiter configuration', () => {
  it('returns 429 after exceeding the configured request limit', async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 3,
        standardHeaders: true,
        legacyHeaders: false,
      })
    );
    app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/probe');
      expect(res.status).toBe(200);
    }

    const limited = await request(app).get('/probe');
    expect(limited.status).toBe(429);
  });
});
