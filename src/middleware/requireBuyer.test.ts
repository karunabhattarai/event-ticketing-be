import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireBuyer } from './requireBuyer';
import { signJwt } from '../lib/auth';
import { env } from '../env';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', requireBuyer, (req, res) => {
    res.json({ buyerId: req.buyerId });
  });
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

describe('requireBuyer', () => {
  it('allows a request with a valid cookie', async () => {
    const token = signJwt({ id: 'buyer-1' }, env.buyerJwtSecret);
    const res = await request(buildTestApp()).get('/protected').set('Cookie', [`buyer_token=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.buyerId).toBe('buyer-1');
  });

  it('rejects a request with no cookie', async () => {
    const res = await request(buildTestApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid cookie', async () => {
    const res = await request(buildTestApp()).get('/protected').set('Cookie', ['buyer_token=garbage']);
    expect(res.status).toBe(401);
  });
});
