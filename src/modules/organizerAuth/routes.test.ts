import { describe, it, expect, beforeEach } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

beforeEach(async () => {
  await truncateAll();
});

describe('POST /organizer/auth/register', () => {
  it('creates an organizer and sets a cookie', async () => {
    const res = await testApp()
      .post('/organizer/auth/register')
      .send({ email: 'org@example.com', password: 'password123', name: 'Org One' });

    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/organizer_token=/);
    const stored = await prisma.organizer.findUnique({ where: { email: 'org@example.com' } });
    expect(stored?.name).toBe('Org One');
    expect(stored?.passwordHash).not.toBe('password123');
  });

  it('rejects a duplicate email', async () => {
    await testApp().post('/organizer/auth/register').send({ email: 'dup@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/organizer/auth/register').send({ email: 'dup@example.com', password: 'password123', name: 'B' });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid body', async () => {
    const res = await testApp().post('/organizer/auth/register').send({ email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /organizer/auth/login', () => {
  it('logs in with correct credentials', async () => {
    await testApp().post('/organizer/auth/register').send({ email: 'login@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/organizer/auth/login').send({ email: 'login@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/organizer_token=/);
  });

  it('rejects wrong password', async () => {
    await testApp().post('/organizer/auth/register').send({ email: 'wrong@example.com', password: 'password123', name: 'A' });
    const res = await testApp().post('/organizer/auth/login').send({ email: 'wrong@example.com', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown email', async () => {
    const res = await testApp().post('/organizer/auth/login').send({ email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});
