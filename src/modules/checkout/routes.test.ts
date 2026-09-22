import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

beforeEach(async () => {
  await truncateAll();
});

let orgCounter = 0;

async function setupPublishedEventWithTier(quantityTotal = 10) {
  orgCounter += 1;
  const orgRes = await testApp().post('/organizer/auth/register').send({ email: `org${orgCounter}@example.com`, password: 'password123', name: 'Org' });
  const cookie = orgRes.headers['set-cookie'];
  const eventRes = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
  await testApp().patch(`/events/${eventRes.body.id}`).set('Cookie', cookie).send({ status: 'published' });
  const tierRes = await testApp().post(`/events/${eventRes.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal });
  return { eventId: eventRes.body.id, tierId: tierRes.body.id };
}

describe('POST /checkout', () => {
  it('creates a pending order and reserves stock', async () => {
    const { tierId } = await setupPublishedEventWithTier(10);
    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId, quantity: 2 }], guestEmail: 'buyer@example.com', guestName: 'Buyer', paymentMethod: 'redirect' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(Number(res.body.totalAmount)).toBe(1600);

    const tier = await prisma.ticketTier.findUnique({ where: { id: tierId } });
    expect(tier?.quantitySold).toBe(2);
  });

  it('rejects checkout when requested quantity exceeds remaining stock', async () => {
    const { tierId } = await setupPublishedEventWithTier(1);
    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId, quantity: 5 }], guestEmail: 'buyer@example.com', guestName: 'Buyer', paymentMethod: 'redirect' });
    expect(res.status).toBe(409);

    const tier = await prisma.ticketTier.findUnique({ where: { id: tierId } });
    expect(tier?.quantitySold).toBe(0);
  });

  it('associates the order with buyerId when logged in', async () => {
    const { tierId } = await setupPublishedEventWithTier(10);
    const buyerRes = await testApp().post('/buyer/auth/register').send({ email: 'b@example.com', password: 'password123', name: 'B' });
    const res = await testApp()
      .post('/checkout')
      .set('Cookie', buyerRes.headers['set-cookie'])
      .send({ items: [{ tierId, quantity: 1 }], paymentMethod: 'redirect' });
    expect(res.status).toBe(201);
    expect(res.body.buyerId).toBeTruthy();
  });

  it('rejects a checkout mixing tiers from different events', async () => {
    const a = await setupPublishedEventWithTier(10);
    const b = await setupPublishedEventWithTier(10);
    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId: a.tierId, quantity: 1 }, { tierId: b.tierId, quantity: 1 }], guestEmail: 'x@example.com', guestName: 'X', paymentMethod: 'redirect' });
    expect(res.status).toBe(400);
  });

  it('rejects checkout when the tier sales window has not started yet', async () => {
    const { tierId } = await setupPublishedEventWithTier(10);
    await prisma.ticketTier.update({
      where: { id: tierId },
      data: { salesStartAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId, quantity: 1 }], guestEmail: 'buyer@example.com', guestName: 'Buyer', paymentMethod: 'redirect' });
    expect(res.status).toBe(400);
  });

  it('rejects checkout when the tier sales window has already ended', async () => {
    const { tierId } = await setupPublishedEventWithTier(10);
    await prisma.ticketTier.update({
      where: { id: tierId },
      data: { salesEndAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId, quantity: 1 }], guestEmail: 'buyer@example.com', guestName: 'Buyer', paymentMethod: 'redirect' });
    expect(res.status).toBe(400);
  });

  it('allows checkout when the tier sales window includes now', async () => {
    const { tierId } = await setupPublishedEventWithTier(10);
    await prisma.ticketTier.update({
      where: { id: tierId },
      data: {
        salesStartAt: new Date(Date.now() - 60 * 60 * 1000),
        salesEndAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId, quantity: 1 }], guestEmail: 'buyer@example.com', guestName: 'Buyer', paymentMethod: 'redirect' });
    expect(res.status).toBe(201);
  });

  it('uses the tier price/quantityTotal as of the reservation transaction, not a stale pre-transaction snapshot', async () => {
    const { tierId } = await setupPublishedEventWithTier(1);
    // Simulate an organizer editing the tier (raising the price and stock) after checkout
    // has already read it but before the reservation transaction runs, by patching the
    // one call the handler makes to fetch tiers up front.
    const originalFindMany = prisma.ticketTier.findMany.bind(prisma.ticketTier);
    const spy = vi.spyOn(prisma.ticketTier, 'findMany').mockImplementationOnce(async (args) => {
      const result = await originalFindMany(args as never);
      await prisma.ticketTier.update({ where: { id: tierId }, data: { price: 1500, quantityTotal: 5 } });
      return result;
    });

    const res = await testApp()
      .post('/checkout')
      .send({ items: [{ tierId, quantity: 3 }], guestEmail: 'buyer@example.com', guestName: 'Buyer', paymentMethod: 'redirect' });

    spy.mockRestore();

    // Fresh quantityTotal (5) allows 3 more than the stale snapshot (1) would have,
    // and totalAmount reflects the fresh price (1500), not the stale one (800).
    expect(res.status).toBe(201);
    expect(Number(res.body.totalAmount)).toBe(4500);
  });
});
