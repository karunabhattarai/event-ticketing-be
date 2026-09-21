import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireBuyerOptional } from './requireBuyerOptional';
import { signJwt } from '../lib/auth';
import { env } from '../env';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/maybe-protected', requireBuyerOptional, (req, res) => {
    res.json({ buyerId: req.buyerId ?? null });
  });
  return app;
}

describe('requireBuyerOptional', () => {
  it('sets buyerId when a valid cookie is present', async () => {
    const token = signJwt({ id: 'buyer-1' }, env.buyerJwtSecret);
    const res = await request(buildTestApp())
      .get('/maybe-protected')
      .set('Cookie', [`buyer_token=${token}`]);
    expect(res.body.buyerId).toBe('buyer-1');
  });

  it('proceeds with null buyerId when no cookie is present (guest)', async () => {
    const res = await request(buildTestApp()).get('/maybe-protected');
    expect(res.status).toBe(200);
    expect(res.body.buyerId).toBeNull();
  });

  it('proceeds with null buyerId on an invalid cookie, never rejects', async () => {
    const res = await request(buildTestApp())
      .get('/maybe-protected')
      .set('Cookie', ['buyer_token=garbage']);
    expect(res.status).toBe(200);
    expect(res.body.buyerId).toBeNull();
  });
});
