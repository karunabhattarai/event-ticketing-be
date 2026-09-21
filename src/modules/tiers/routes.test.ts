import { describe, it, expect, beforeEach } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';

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
});
