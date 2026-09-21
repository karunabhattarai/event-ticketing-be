import { describe, it, expect, beforeEach } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

beforeEach(async () => {
  await truncateAll();
});

async function registerOrganizer(email = 'org@example.com') {
  const res = await testApp().post('/organizer/auth/register').send({ email, password: 'password123', name: 'Org' });
  const cookie = res.headers['set-cookie'];
  return { cookie, id: res.body.id };
}

describe('POST /events', () => {
  it('creates a draft event for the authenticated organizer', async () => {
    const { cookie } = await registerOrganizer();
    const res = await testApp()
      .post('/events')
      .set('Cookie', cookie)
      .send({ title: 'Rock Show', description: 'desc', venue: 'Venue', startsAt: '2026-12-01T18:00:00Z' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await testApp().post('/events').send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /events/:id', () => {
  it('lets the owning organizer publish their event', async () => {
    const { cookie } = await registerOrganizer();
    const create = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const res = await testApp().patch(`/events/${create.body.id}`).set('Cookie', cookie).send({ status: 'published' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
  });

  it("rejects editing another organizer's event", async () => {
    const owner = await registerOrganizer('owner@example.com');
    const other = await registerOrganizer('other@example.com');
    const create = await testApp().post('/events').set('Cookie', owner.cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const res = await testApp().patch(`/events/${create.body.id}`).set('Cookie', other.cookie).send({ status: 'published' });
    expect(res.status).toBe(404);
  });
});

describe('GET /events (public)', () => {
  it('only lists published events', async () => {
    const { cookie } = await registerOrganizer();
    const draft = await testApp().post('/events').set('Cookie', cookie).send({ title: 'Draft Event', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const published = await testApp().post('/events').set('Cookie', cookie).send({ title: 'Published Event', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().patch(`/events/${published.body.id}`).set('Cookie', cookie).send({ status: 'published' });

    const res = await testApp().get('/events');
    const titles = res.body.map((e: any) => e.title);
    expect(titles).toContain('Published Event');
    expect(titles).not.toContain('Draft Event');
  });

  it('includes tiers on each event', async () => {
    const { cookie } = await registerOrganizer();
    const published = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().post(`/events/${published.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 100 });
    await testApp().patch(`/events/${published.body.id}`).set('Cookie', cookie).send({ status: 'published' });

    const res = await testApp().get('/events');
    const event = res.body.find((e: any) => e.id === published.body.id);
    expect(event.tiers.length).toBe(1);
    expect(event.tiers[0].name).toBe('General');
  });

  it('paginates results with pageSize', async () => {
    const { cookie } = await registerOrganizer();
    const a = await testApp().post('/events').set('Cookie', cookie).send({ title: 'A', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const b = await testApp().post('/events').set('Cookie', cookie).send({ title: 'B', description: 'd', venue: 'v', startsAt: '2026-12-02T18:00:00Z' });
    await testApp().patch(`/events/${a.body.id}`).set('Cookie', cookie).send({ status: 'published' });
    await testApp().patch(`/events/${b.body.id}`).set('Cookie', cookie).send({ status: 'published' });

    const res = await testApp().get('/events').query({ pageSize: 1 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('GET /events/:id (public)', () => {
  it('404s for a draft event', async () => {
    const { cookie } = await registerOrganizer();
    const create = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const res = await testApp().get(`/events/${create.body.id}`);
    expect(res.status).toBe(404);
  });

  it('200s for a published event', async () => {
    const { cookie } = await registerOrganizer();
    const create = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().patch(`/events/${create.body.id}`).set('Cookie', cookie).send({ status: 'published' });
    const res = await testApp().get(`/events/${create.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('X');
  });

  it('lets the owning organizer view their own draft event by id', async () => {
    const { cookie } = await registerOrganizer();
    const create = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const res = await testApp().get(`/events/${create.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('X');
  });

  it("404s a different organizer's draft event, even when authenticated", async () => {
    const owner = await registerOrganizer('draft-owner@example.com');
    const other = await registerOrganizer('draft-other@example.com');
    const create = await testApp().post('/events').set('Cookie', owner.cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const res = await testApp().get(`/events/${create.body.id}`).set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /events/mine', () => {
  it("lists the organizer's own events regardless of status", async () => {
    const { cookie } = await registerOrganizer();
    await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    const res = await testApp().get('/events/mine').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('includes tiers on each event', async () => {
    const { cookie } = await registerOrganizer();
    const create = await testApp().post('/events').set('Cookie', cookie).send({ title: 'X', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().post(`/events/${create.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 800, quantityTotal: 100 });
    const res = await testApp().get('/events/mine').set('Cookie', cookie);
    expect(res.body[0].tiers.length).toBe(1);
    expect(res.body[0].tiers[0].name).toBe('General');
  });
});

describe('GET /events/mine/stats', () => {
  it('aggregates tickets sold, revenue, and check-ins across all owned events', async () => {
    const { cookie } = await registerOrganizer();
    const eventA = await testApp().post('/events').set('Cookie', cookie).send({ title: 'A', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().patch(`/events/${eventA.body.id}`).set('Cookie', cookie).send({ status: 'published' });
    const tierA = await testApp().post(`/events/${eventA.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 500, quantityTotal: 100 });

    const orderRes = await testApp().post('/checkout').send({ items: [{ tierId: tierA.body.id, quantity: 2 }], guestEmail: 'b@example.com', guestName: 'B', paymentMethod: 'redirect' });
    await prisma.order.update({ where: { id: orderRes.body.id }, data: { status: 'paid', paidAt: new Date() } });
    // ticketsSold counts Ticket rows (created by fulfillOrder), not the
    // checkout-time reservation counter — create them directly here since
    // this test isn't exercising the fulfillment flow itself.
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: orderRes.body.id } });
    await prisma.ticket.createMany({
      data: [
        { orderItemId: item.id, code: 'stats-code-1' },
        { orderItemId: item.id, code: 'stats-code-2' },
      ],
    });

    const res = await testApp().get('/events/mine/stats').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ticketsSold).toBe(2);
    expect(res.body.revenue).toBe('1000');
    expect(res.body.ticketsCheckedIn).toBe(0);
  });

  it('excludes a pending (unpaid, abandoned) order from both ticketsSold and revenue', async () => {
    const { cookie } = await registerOrganizer();
    const eventA = await testApp().post('/events').set('Cookie', cookie).send({ title: 'A', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().patch(`/events/${eventA.body.id}`).set('Cookie', cookie).send({ status: 'published' });
    const tierA = await testApp().post(`/events/${eventA.body.id}/tiers`).set('Cookie', cookie).send({ name: 'General', price: 500, quantityTotal: 100 });
    // Checkout reserves quantitySold but the order is left pending (abandoned) —
    // this must not show up as "sold" or revenue.
    await testApp().post('/checkout').send({ items: [{ tierId: tierA.body.id, quantity: 3 }], guestEmail: 'b@example.com', guestName: 'B', paymentMethod: 'redirect' });

    const res = await testApp().get('/events/mine/stats').set('Cookie', cookie);
    expect(res.body.ticketsSold).toBe(0);
    expect(res.body.revenue).toBe('0');
  });

  it("only counts the requesting organizer's own events", async () => {
    const mine = await registerOrganizer('mine@example.com');
    const other = await registerOrganizer('other-stats@example.com');
    const otherEvent = await testApp().post('/events').set('Cookie', other.cookie).send({ title: 'Other', description: 'd', venue: 'v', startsAt: '2026-12-01T18:00:00Z' });
    await testApp().patch(`/events/${otherEvent.body.id}`).set('Cookie', other.cookie).send({ status: 'published' });
    await testApp().post(`/events/${otherEvent.body.id}/tiers`).set('Cookie', other.cookie).send({ name: 'General', price: 500, quantityTotal: 100 });

    const res = await testApp().get('/events/mine/stats').set('Cookie', mine.cookie);
    expect(res.body.ticketsSold).toBe(0);
    expect(res.body.revenue).toBe('0');
  });
});
