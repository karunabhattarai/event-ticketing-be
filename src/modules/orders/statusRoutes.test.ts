import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

vi.mock('@arbyte-solutions/mail-service', () => ({ sendMail: vi.fn(async () => {}) }));
import { sendMail } from '@arbyte-solutions/mail-service';

beforeEach(async () => {
  await truncateAll();
  vi.mocked(sendMail).mockReset().mockResolvedValue(undefined as never);
});

async function setupOrder() {
  return prisma.order.create({
    data: { guestEmail: 'b@example.com', guestName: 'B', status: 'pending', totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-STATUS-1' },
  });
}

describe('GET /orders/:id', () => {
  it('returns the order when the access token matches', async () => {
    const order = await setupOrder();
    const res = await testApp().get(`/orders/${order.id}`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('403s with no token', async () => {
    const order = await setupOrder();
    const res = await testApp().get(`/orders/${order.id}`);
    expect(res.status).toBe(403);
  });

  it('403s with a wrong token', async () => {
    const order = await setupOrder();
    const res = await testApp().get(`/orders/${order.id}`).query({ token: 'wrong-token' });
    expect(res.status).toBe(403);
  });

  it('403s (not 404) for a nonexistent order id, to avoid leaking which ids exist', async () => {
    const res = await testApp().get('/orders/00000000-0000-4000-8000-000000000000').query({ token: 'anything' });
    expect(res.status).toBe(403);
  });
});

describe('POST /orders/:id/resend', () => {
  it('resends the ticket email for a paid order when the token matches', async () => {
    const order = await prisma.order.create({
      data: { guestEmail: 'b@example.com', guestName: 'B', status: 'paid', paidAt: new Date(), totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-RESEND-1' },
    });
    const res = await testApp().post(`/orders/${order.id}/resend`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
  });

  it('403s without a matching token', async () => {
    const order = await prisma.order.create({
      data: { guestEmail: 'b@example.com', guestName: 'B', status: 'paid', paidAt: new Date(), totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-RESEND-2' },
    });
    const res = await testApp().post(`/orders/${order.id}/resend`).query({ token: 'wrong' });
    expect(res.status).toBe(403);
  });

  it('rejects resending for an order that was never paid', async () => {
    const order = await setupOrder();
    const res = await testApp().post(`/orders/${order.id}/resend`).query({ token: order.accessToken });
    expect(res.status).toBe(400);
  });

  it('502s when the ticket email actually fails to send', async () => {
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('smtp down'));
    const order = await prisma.order.create({
      data: { guestEmail: 'b@example.com', guestName: 'B', status: 'paid', paidAt: new Date(), totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-RESEND-3' },
    });
    const res = await testApp().post(`/orders/${order.id}/resend`).query({ token: order.accessToken });
    expect(res.status).toBe(502);
  });
});
