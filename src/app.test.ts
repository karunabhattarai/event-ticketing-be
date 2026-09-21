import { describe, it, expect } from 'vitest';
import { testApp } from '../tests/helpers/testApp';

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
