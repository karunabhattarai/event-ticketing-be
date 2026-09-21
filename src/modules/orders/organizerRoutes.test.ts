import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

vi.mock('@arbyte-solutions/mail-service', () => ({ sendMail: vi.fn(async () => {}) }));
import { sendMail } from '@arbyte-solutions/mail-service';

beforeEach(async () => {
  await truncateAll();
  vi.mocked(sendMail).mockClear();
});

async function setupFulfilledOrder(organizerEmail = 'org@example.com') {
  const orgRes = await testApp().post('/organizer/auth/register').send({ email: organizerEmail, password: 'password123', name: 'Org' });
  const cookie = orgRes.headers['set-cookie'];
  const eventRes = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
  await testApp().patch(`/events/${eventRes.body.id}`).set('Cookie', cookie).send({ status: 'published' });
  const tierRes = await testApp().post(`/events/${eventRes.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 10 });
  const orderRes = await testApp().post('/checkout').send({ items: [{ tierId: tierRes.body.id, quantity: 1 }], guestEmail: 'b@example.com', guestName: 'B', paymentMethod: 'redirect' });

  vi.mocked(sendMail).mockClear(); // reset the mock so tests only see calls made after this point

  return { cookie, eventId: eventRes.body.id, orderId: orderRes.body.id };
}

describe('GET /events/:eventId/orders', () => {
  it('lists orders for the owned event', async () => {
    const { cookie, eventId } = await setupFulfilledOrder();
    const res = await testApp().get(`/events/${eventId}/orders`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBe(1);
    expect(res.body.orders[0].status).toBe('pending');
  });

  it('returns per-status order counts and ticket check-in counts', async () => {
    const { cookie, eventId } = await setupFulfilledOrder(); // one pending order, one tier with 0 tickets issued yet
    const res = await testApp().get(`/events/${eventId}/orders`).set('Cookie', cookie);
    expect(res.body.stats).toEqual({
      pending: 1, paid: 0, fulfilled: 0, failed: 0, refunded: 0,
      ticketsIssued: 0, ticketsCheckedIn: 0,
    });
  });

  it('does not leak the buyer accessToken in the order list', async () => {
    const { cookie, eventId } = await setupFulfilledOrder();
    const res = await testApp().get(`/events/${eventId}/orders`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBeGreaterThan(0);
    for (const order of res.body.orders) {
      expect(order).not.toHaveProperty('accessToken');
    }
  });

  it("rejects listing another organizer's event orders", async () => {
    const { eventId } = await setupFulfilledOrder();
    const other = await testApp().post('/organizer/auth/register').send({ email: 'other@example.com', password: 'password123', name: 'B' });
    const res = await testApp().get(`/events/${eventId}/orders`).set('Cookie', other.headers['set-cookie']);
    expect(res.status).toBe(404);
  });
});

describe('POST /events/:eventId/orders/:orderId/resend', () => {
  it('re-sends the ticket email', async () => {
    const { cookie, eventId, orderId } = await setupFulfilledOrder();
    // setupFulfilledOrder's helper name is aspirational — it only creates a
    // pending order (see the tests above asserting exactly that). Resend
    // requires paid/fulfilled, so mark it paid here before calling resend.
    await prisma.order.update({ where: { id: orderId }, data: { status: 'paid', paidAt: new Date() } });

    const res = await testApp().post(`/events/${eventId}/orders/${orderId}/resend`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('rejects resending for an order that has never been paid', async () => {
    const { cookie, eventId, orderId } = await setupFulfilledOrder();
    const res = await testApp().post(`/events/${eventId}/orders/${orderId}/resend`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("404s resending an order that belongs to a different organizer's event, even though this organizer owns eventId", async () => {
    const { cookie, eventId } = await setupFulfilledOrder('org-a-resend@example.com');
    const other = await setupFulfilledOrder('org-b-resend@example.com'); // owns a different event + order
    await prisma.order.update({ where: { id: other.orderId }, data: { status: 'paid', paidAt: new Date() } });

    const res = await testApp().post(`/events/${eventId}/orders/${other.orderId}/resend`).set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('502s when the ticket email actually fails to send', async () => {
    const { cookie, eventId, orderId } = await setupFulfilledOrder();
    await prisma.order.update({ where: { id: orderId }, data: { status: 'paid', paidAt: new Date() } });
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('smtp down'));

    const res = await testApp().post(`/events/${eventId}/orders/${orderId}/resend`).set('Cookie', cookie);
    expect(res.status).toBe(502);
  });
});

describe('POST /events/:eventId/orders/:orderId/refund', () => {
  it('marks the order refunded and voids its valid tickets', async () => {
    const { cookie, eventId, orderId } = await setupFulfilledOrder();
    // Manually mark paid + fulfilled with a ticket for this test's purposes:
    const order = await prisma.order.update({ where: { id: orderId }, data: { status: 'fulfilled', paidAt: new Date(), fulfilledAt: new Date() } });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const ticket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'test-code-for-refund' } });

    const res = await testApp().post(`/events/${eventId}/orders/${orderId}/refund`).set('Cookie', cookie);
    expect(res.status).toBe(200);

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updatedOrder.status).toBe('refunded');

    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updatedTicket.status).toBe('void');
  });

  it('does not un-use an already-used ticket on refund', async () => {
    const { cookie, eventId, orderId } = await setupFulfilledOrder();
    await prisma.order.update({ where: { id: orderId }, data: { status: 'fulfilled', paidAt: new Date(), fulfilledAt: new Date() } });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const usedTicket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'used-code', status: 'used', checkedInAt: new Date() } });

    await testApp().post(`/events/${eventId}/orders/${orderId}/refund`).set('Cookie', cookie);

    const stillUsed = await prisma.ticket.findUniqueOrThrow({ where: { id: usedTicket.id } });
    expect(stillUsed.status).toBe('used');
  });

  it('rejects refunding an order that was never paid', async () => {
    const { cookie, eventId, orderId } = await setupFulfilledOrder(); // still pending
    const res = await testApp().post(`/events/${eventId}/orders/${orderId}/refund`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending');
  });

  it("404s refunding an order that belongs to a different organizer's event, even though this organizer owns eventId", async () => {
    const { cookie, eventId } = await setupFulfilledOrder('org-a-refund@example.com');
    const other = await setupFulfilledOrder('org-b-refund@example.com');
    await prisma.order.update({ where: { id: other.orderId }, data: { status: 'paid', paidAt: new Date() } });

    const res = await testApp().post(`/events/${eventId}/orders/${other.orderId}/refund`).set('Cookie', cookie);
    expect(res.status).toBe(404);
    const untouched = await prisma.order.findUniqueOrThrow({ where: { id: other.orderId } });
    expect(untouched.status).toBe('paid');
  });
});
