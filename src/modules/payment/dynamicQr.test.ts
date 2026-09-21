import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

const closeMock = vi.fn();
let lastSubscribeCallbacks: { onPaymentSuccess: () => void; onError: () => void } | undefined;

vi.mock('@arbyte-solutions/fonepay-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arbyte-solutions/fonepay-service')>();
  return {
    ...actual,
    generateDynamicQr: vi.fn(async () => ({
      qrMessage: 'FAKE-EMV-DATA',
      thirdpartyQrWebSocketUrl: 'wss://fake',
      status: 'CREATED',
      success: true,
    })),
    checkDynamicQrStatus: vi.fn(async () => ({ paymentStatus: 'pending', fonepayTraceId: '', prn: '', merchantCode: '' })),
    subscribeDynamicQrStatus: vi.fn((_url: string, callbacks: { onPaymentSuccess: () => void; onError: () => void }) => {
      lastSubscribeCallbacks = callbacks;
      return { close: closeMock };
    }),
  };
});

vi.mock('@arbyte-solutions/mail-service', () => ({
  sendMail: vi.fn(async () => {}),
}));

import { checkDynamicQrStatus } from '@arbyte-solutions/fonepay-service';

beforeEach(async () => {
  await truncateAll();
  closeMock.mockClear();
  lastSubscribeCallbacks = undefined;
});

async function setupPendingQrOrder() {
  const orgRes = await testApp().post('/organizer/auth/register').send({ email: 'org@example.com', password: 'password123', name: 'Org' });
  const cookie = orgRes.headers['set-cookie'];
  const eventRes = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
  await testApp().patch(`/events/${eventRes.body.id}`).set('Cookie', cookie).send({ status: 'published' });
  const tierRes = await testApp().post(`/events/${eventRes.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 10 });
  const orderRes = await testApp().post('/checkout').send({ items: [{ tierId: tierRes.body.id, quantity: 1 }], guestEmail: 'b@example.com', guestName: 'B', paymentMethod: 'dynamic_qr' });
  return orderRes.body;
}

describe('POST /payment/dynamic-qr/:orderId/generate', () => {
  it('returns a QR image data URL when the access token matches', async () => {
    const order = await setupPendingQrOrder();
    const res = await testApp().post(`/payment/dynamic-qr/${order.id}/generate`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('403s without a matching access token', async () => {
    const order = await setupPendingQrOrder();
    const res = await testApp().post(`/payment/dynamic-qr/${order.id}/generate`).query({ token: 'wrong-token' });
    expect(res.status).toBe(403);
  });

  it('closes the websocket when onError fires', async () => {
    const order = await setupPendingQrOrder();
    const res = await testApp().post(`/payment/dynamic-qr/${order.id}/generate`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
    expect(closeMock).not.toHaveBeenCalled();

    lastSubscribeCallbacks?.onError();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe('GET /payment/dynamic-qr/:orderId/status', () => {
  it('returns pending while unresolved, polling the fallback status check', async () => {
    const order = await setupPendingQrOrder();
    await testApp().post(`/payment/dynamic-qr/${order.id}/generate`).query({ token: order.accessToken });
    const res = await testApp().get(`/payment/dynamic-qr/${order.id}/status`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(vi.mocked(checkDynamicQrStatus)).toHaveBeenCalled();
  });

  it('returns paid once the order has transitioned, without re-polling Fonepay', async () => {
    const order = await setupPendingQrOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'paid', paidAt: new Date() } });

    vi.mocked(checkDynamicQrStatus).mockClear();
    const res = await testApp().get(`/payment/dynamic-qr/${order.id}/status`).query({ token: order.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(vi.mocked(checkDynamicQrStatus)).not.toHaveBeenCalled();
  });

  it('403s without a matching access token', async () => {
    const order = await setupPendingQrOrder();
    const res = await testApp().get(`/payment/dynamic-qr/${order.id}/status`).query({ token: 'wrong-token' });
    expect(res.status).toBe(403);
  });
});
