import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../db/client';
import { truncateAll } from '../../tests/helpers/testDb';

beforeEach(async () => {
  await truncateAll();
});

describe('Order.accessToken', () => {
  it('is auto-generated and unique per order', async () => {
    const org = await prisma.organizer.create({
      data: { email: 'org@example.com', passwordHash: 'x', name: 'Org' },
    });
    const event = await prisma.event.create({
      data: { organizerId: org.id, title: 'E', description: 'd', venue: 'v', startsAt: new Date() },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'General', price: 100, quantityTotal: 10 },
    });
    const orderA = await prisma.order.create({
      data: { totalAmount: 100, paymentMethod: 'redirect', prn: 'PRN-A' },
    });
    const orderB = await prisma.order.create({
      data: { totalAmount: 100, paymentMethod: 'redirect', prn: 'PRN-B' },
    });

    expect(orderA.accessToken).toBeTruthy();
    expect(orderB.accessToken).toBeTruthy();
    expect(orderA.accessToken).not.toBe(orderB.accessToken);
    // UUID v4 shape, not a guessable sequential value
    expect(orderA.accessToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
