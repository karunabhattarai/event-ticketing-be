import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

beforeEach(async () => {
  await truncateAll();
});

async function setupEvent() {
  const orgRes = await testApp().post('/organizer/auth/register').send({ email: 'org@example.com', password: 'password123', name: 'Org' });
  const cookie = orgRes.headers['set-cookie'];
  const eventRes = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
  return { cookie, eventId: eventRes.body.id };
}

describe('POST /events/:eventId/tiers', () => {
  it('creates a tier for the owned event', async () => {
    const { cookie, eventId } = await setupEvent();
    const res = await testApp()
      .post(`/events/${eventId}/tiers`)
      .set('Cookie', cookie)
      .send({ name: 'General', price: 800, quantityTotal: 100 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('General');
    expect(res.body.quantitySold).toBe(0);
  });

  it("rejects creating a tier on another organizer's event", async () => {
    const { eventId } = await setupEvent();
    const other = await testApp().post('/organizer/auth/register').send({ email: 'other@example.com', password: 'password123', name: 'B' });
    const res = await testApp()
      .post(`/events/${eventId}/tiers`)
      .set('Cookie', other.headers['set-cookie'])
      .send({ name: 'General', price: 800, quantityTotal: 100 });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /events/:eventId/tiers/:tierId', () => {
  it('edits a tier', async () => {
    const { cookie, eventId } = await setupEvent();
    const create = await testApp().post(`/events/${eventId}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 100 });
    const res = await testApp().patch(`/events/${eventId}/tiers/${create.body.id}`).set('Cookie', cookie).send({ price: 900 });
    expect(res.status).toBe(200);
    expect(Number(res.body.price)).toBe(900);
  });

  it('rejects lowering quantityTotal below quantitySold', async () => {
    const { cookie, eventId } = await setupEvent();
    const create = await testApp().post(`/events/${eventId}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 100 });
    await prisma.ticketTier.update({ where: { id: create.body.id }, data: { quantitySold: 10 } });

    const res = await testApp().patch(`/events/${eventId}/tiers/${create.body.id}`).set('Cookie', cookie).send({ quantityTotal: 5 });
    expect(res.status).toBe(400);

    const unchanged = await prisma.ticketTier.findUniqueOrThrow({ where: { id: create.body.id } });
    expect(unchanged.quantityTotal).toBe(100);
  });

  it('rejects the update atomically if quantitySold rises past the new quantityTotal between the read and the write', async () => {
    const { cookie, eventId } = await setupEvent();
    const create = await testApp().post(`/events/${eventId}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 100 });
    await prisma.ticketTier.update({ where: { id: create.body.id }, data: { quantitySold: 5 } });

    // Simulate a concurrent checkout landing between the ownership-check read and the
    // atomic write statement: quantitySold rises to 12 right after the handler's
    // pre-check (5 < 10) but before its guarded update runs.
    const originalUpdateMany = prisma.ticketTier.updateMany.bind(prisma.ticketTier);
    const spy = vi.spyOn(prisma.ticketTier, 'updateMany').mockImplementationOnce(((args: never) => {
      return prisma.ticketTier
        .update({ where: { id: create.body.id }, data: { quantitySold: 12 } })
        .then(() => originalUpdateMany(args));
    }) as typeof prisma.ticketTier.updateMany);

    const res = await testApp().patch(`/events/${eventId}/tiers/${create.body.id}`).set('Cookie', cookie).send({ quantityTotal: 10 });

    spy.mockRestore();
    expect(res.status).toBe(409);
    const unchanged = await prisma.ticketTier.findUniqueOrThrow({ where: { id: create.body.id } });
    expect(unchanged.quantityTotal).toBe(100);
    expect(unchanged.quantitySold).toBe(12);
  });

  it('clears salesEndAt back to null when explicitly sent as null', async () => {
    const { cookie, eventId } = await setupEvent();
    const create = await testApp()
      .post(`/events/${eventId}/tiers`)
      .set('Cookie', cookie)
      .send({ name: 'General', price: 800, quantityTotal: 100, salesEndAt: '2026-12-01T00:00:00Z' });
    expect(create.body.salesEndAt).not.toBeNull();

    const res = await testApp()
      .patch(`/events/${eventId}/tiers/${create.body.id}`)
      .set('Cookie', cookie)
      .send({ salesEndAt: null });
    expect(res.status).toBe(200);
    expect(res.body.salesEndAt).toBeNull();

    const updated = await prisma.ticketTier.findUniqueOrThrow({ where: { id: create.body.id } });
    expect(updated.salesEndAt).toBeNull();
  });
});
