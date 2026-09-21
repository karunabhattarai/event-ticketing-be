import { describe, it, expect, beforeEach } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';
import { signTicketCode } from '../../lib/ticketCode';

beforeEach(async () => {
  await truncateAll();
});

async function setupValidTicket() {
  const orgRes = await testApp().post('/organizer/auth/register').send({ email: 'org@example.com', password: 'password123', name: 'Org' });
  const cookie = orgRes.headers['set-cookie'];
  const organizer = await prisma.organizer.findUniqueOrThrow({ where: { email: 'org@example.com' } });
  const event = await prisma.event.create({ data: { organizerId: organizer.id, title: 'X', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'General', price: 800, quantityTotal: 10, quantitySold: 1 } });
  const order = await prisma.order.create({ data: { guestEmail: 'b@example.com', guestName: 'B', status: 'fulfilled', totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-CI-1' } });
  const item = await prisma.orderItem.create({ data: { orderId: order.id, ticketTierId: tier.id, quantity: 1, unitPrice: 800 } });
  const ticket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'placeholder' } });
  const code = signTicketCode(ticket.id, event.id);
  await prisma.ticket.update({ where: { id: ticket.id }, data: { code } });
  return { cookie, code };
}

describe('POST /checkin/:code', () => {
  it('checks in a valid ticket', async () => {
    const { cookie, code } = await setupValidTicket();
    const res = await testApp().post(`/checkin/${encodeURIComponent(code)}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('valid');
  });

  it('rejects a second scan of the same ticket', async () => {
    const { cookie, code } = await setupValidTicket();
    await testApp().post(`/checkin/${encodeURIComponent(code)}`).set('Cookie', cookie);
    const res = await testApp().post(`/checkin/${encodeURIComponent(code)}`).set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.result).toBe('already_used');
  });

  it('rejects a tampered code', async () => {
    const { cookie, code } = await setupValidTicket();
    const res = await testApp().post(`/checkin/${encodeURIComponent(code + 'x')}`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it("rejects check-in by an organizer who doesn't own the event", async () => {
    const { code } = await setupValidTicket();
    const other = await testApp().post('/organizer/auth/register').send({ email: 'other@example.com', password: 'password123', name: 'B' });
    const res = await testApp().post(`/checkin/${encodeURIComponent(code)}`).set('Cookie', other.headers['set-cookie']);
    expect(res.status).toBe(404);
  });

  it('rejects check-in for a ticket whose order was refunded after minting', async () => {
    const { cookie, code } = await setupValidTicket();
    const decoded = await import('../../lib/ticketCode').then((m) => m.verifyTicketCode(code));
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: decoded!.ticketId } });
    const orderItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: ticket.orderItemId } });
    await prisma.order.update({ where: { id: orderItem.orderId }, data: { status: 'refunded' } });

    const res = await testApp().post(`/checkin/${encodeURIComponent(code)}`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('falls back to the buyer account name when the order has no guestName (logged-in buyer checkout)', async () => {
    const orgRes = await testApp().post('/organizer/auth/register').send({ email: 'org2@example.com', password: 'password123', name: 'Org' });
    const cookie = orgRes.headers['set-cookie'];
    const organizer = await prisma.organizer.findUniqueOrThrow({ where: { email: 'org2@example.com' } });
    const buyer = await prisma.buyer.create({ data: { email: 'buyer@example.com', name: 'Account Holder' } });
    const event = await prisma.event.create({ data: { organizerId: organizer.id, title: 'X', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' } });
    const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'General', price: 800, quantityTotal: 10, quantitySold: 1 } });
    const order = await prisma.order.create({ data: { buyerId: buyer.id, status: 'fulfilled', totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-CI-BUYER' } });
    const item = await prisma.orderItem.create({ data: { orderId: order.id, ticketTierId: tier.id, quantity: 1, unitPrice: 800 } });
    const ticket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'placeholder' } });
    const code = signTicketCode(ticket.id, event.id);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { code } });

    const res = await testApp().post(`/checkin/${encodeURIComponent(code)}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.holderName).toBe('Account Holder');
  });
});
