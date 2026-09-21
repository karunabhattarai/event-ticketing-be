import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { testApp } from '../tests/helpers/testApp';
import { createApp } from './app';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await testApp().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows the frontend origin with credentials via CORS', async () => {
    const res = await testApp().get('/health').set('Origin', process.env.APP_BASE_URL!);
    expect(res.headers['access-control-allow-origin']).toBe(process.env.APP_BASE_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('requireCsrfHeader', () => {
  it('rejects a POST request without the X-Requested-With header with 403', async () => {
    // Use raw supertest here (not the testApp() wrapper, which auto-attaches
    // the header) to prove the guard actually rejects requests lacking it.
    const res = await request(createApp()).post('/organizer/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('allows a GET request without the header (safe methods are exempt)', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
