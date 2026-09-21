import { describe, it, expect, beforeEach } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

beforeEach(async () => {
  await truncateAll();
});

describe('POST /buyer/auth/register', () => {
  it('creates a buyer and sets a cookie', async () => {
    const res = await testApp()
      .post('/buyer/auth/register')
      .send({ email: 'buyer@example.com', password: 'password123', name: 'Buyer One' });

    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/buyer_token=/);
    const stored = await prisma.buyer.findUnique({ where: { email: 'buyer@example.com' } });
    expect(stored?.name).toBe('Buyer One');
  });

  it('rejects a duplicate email', async () => {
    await testApp().post('/buyer/auth/register').send({ email: 'dup2@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/buyer/auth/register').send({ email: 'dup2@example.com', password: 'password123', name: 'B' });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid body', async () => {
    const res = await testApp().post('/buyer/auth/register').send({ email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /buyer/auth/login', () => {
  it('logs in with correct credentials', async () => {
    await testApp().post('/buyer/auth/register').send({ email: 'blogin@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/buyer/auth/login').send({ email: 'blogin@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/buyer_token=/);
  });

  it('rejects wrong password', async () => {
    await testApp().post('/buyer/auth/register').send({ email: 'bwrong@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/buyer/auth/login').send({ email: 'bwrong@example.com', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown email', async () => {
    const res = await testApp().post('/buyer/auth/login').send({ email: 'nobody-buyer@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});

describe('POST /buyer/auth/logout', () => {
  it('clears the buyer_token cookie', async () => {
    await testApp().post('/buyer/auth/register').send({ email: 'blogout@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/buyer/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/buyer_token=;/);
  });
});
