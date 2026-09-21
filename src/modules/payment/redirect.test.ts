import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

vi.mock('@arbyte-solutions/fonepay-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arbyte-solutions/fonepay-service')>();
  return {
    ...actual,
    initiatePayment: vi.fn(() => ({ url: 'https://dev-clientapi.fonepay.com/fake-redirect' })),
    verifyResponse: vi.fn(),
  };
});

vi.mock('@arbyte-solutions/mail-service', () => ({
  sendMail: vi.fn(async () => {}),
}));

import { verifyResponse } from '@arbyte-solutions/fonepay-service';

beforeEach(async () => {
  await truncateAll();
});

async function setupPendingOrder() {
  const orgRes = await testApp().post('/organizer/auth/register').send({ email: 'org@example.com', password: 'password123', name: 'Org' });
  const cookie = orgRes.headers['set-cookie'];
  const eventRes = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
  await testApp().patch(`/events/${eventRes.body.id}`).set('Cookie', cookie).send({ status: 'published' });
  const tierRes = await testApp().post(`/events/${eventRes.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 10 });
  const orderRes = await testApp().post('/checkout').send({ items: [{ tierId: tierRes.body.id, quantity: 1 }], guestEmail: 'b@example.com', guestName: 'B', paymentMethod: 'redirect' });
  return orderRes.body;
}

describe('POST /payment/redirect/:orderId/initiate', () => {
  it('returns the Fonepay redirect URL when the access token matches', async () => {
    const order = await setupPendingOrder();
    const res = await testApp().post(`/payment/redirect/${order.id}/initiate`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('fonepay');
  });

  it('403s without a matching access token', async () => {
    const order = await setupPendingOrder();
    const res = await testApp().post(`/payment/redirect/${order.id}/initiate`).query({ token: 'wrong-token' });
    expect(res.status).toBe(403);
  });
});

describe('GET /payment/redirect/return', () => {
  it('marks the order paid on a valid successful callback', async () => {
    const order = await setupPendingOrder();
    vi.mocked(verifyResponse).mockReturnValue(true);

    const res = await testApp().get('/payment/redirect/return').query({ PRN: order.prn, RC: 'successful', DV: 'x', PID: 'x', PS: 'x', UID: 'x', BC: 'x', INI: 'x', P_AMT: '800', R_AMT: '800' });

    expect(res.status).toBe(302);
    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    // fulfillOrder (Task 15) runs synchronously after the paid claim and, with
    // sendMail mocked to succeed, advances the order straight to 'fulfilled'.
    expect(updated?.status).toBe('fulfilled');
  });

  it('marks the order failed and releases stock on an invalid callback', async () => {
    const order = await setupPendingOrder();
    vi.mocked(verifyResponse).mockReturnValue(false);

    await testApp().get('/payment/redirect/return').query({ PRN: order.prn, RC: 'failed', DV: 'x', PID: 'x', PS: 'x', UID: 'x', BC: 'x', INI: 'x', P_AMT: '800', R_AMT: '800' });

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe('failed');

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const tier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: item.ticketTierId } });
    expect(tier.quantitySold).toBe(0);
  });

  it('is idempotent — a second callback on an already-paid order is a no-op', async () => {
    const order = await setupPendingOrder();
    vi.mocked(verifyResponse).mockReturnValue(true);

    await testApp().get('/payment/redirect/return').query({ PRN: order.prn, RC: 'successful', DV: 'x', PID: 'x', PS: 'x', UID: 'x', BC: 'x', INI: 'x', P_AMT: '800', R_AMT: '800' });
    const beforeSecondCall = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    await testApp().get('/payment/redirect/return').query({ PRN: order.prn, RC: 'successful', DV: 'x', PID: 'x', PS: 'x', UID: 'x', BC: 'x', INI: 'x', P_AMT: '800', R_AMT: '800' });
    const afterSecondCall = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(afterSecondCall.paidAt?.getTime()).toBe(beforeSecondCall.paidAt?.getTime());
  });
});
