import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireOrganizer } from './requireOrganizer';
import { signJwt } from '../lib/auth';
import { env } from '../env';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', requireOrganizer, (req, res) => {
    res.json({ organizerId: req.organizerId });
  });
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

describe('requireOrganizer', () => {
  it('allows a request with a valid cookie', async () => {
    const token = signJwt({ id: 'org-1' }, env.organizerJwtSecret);
    const res = await request(buildTestApp())
      .get('/protected')
      .set('Cookie', [`organizer_token=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.organizerId).toBe('org-1');
  });

  it('rejects a request with no cookie', async () => {
    const res = await request(buildTestApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid cookie', async () => {
    const res = await request(buildTestApp())
      .get('/protected')
      .set('Cookie', ['organizer_token=garbage']);
    expect(res.status).toBe(401);
  });
});
