import { describe, it, expect, beforeEach, vi } from 'vitest';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

vi.mock('@arbyte-solutions/mail-service', () => ({
  sendMail: vi.fn(async () => {}),
}));

import { sendMail } from '@arbyte-solutions/mail-service';
import { fulfillOrder } from './service';

beforeEach(async () => {
  await truncateAll();
  vi.mocked(sendMail).mockClear();
});

async function setupPaidOrder(quantity = 2) {
  const organizer = await prisma.organizer.create({ data: { email: 'o@example.com', passwordHash: 'x', name: 'O' } });
  const event = await prisma.event.create({ data: { organizerId: organizer.id, title: 'Show', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'General', price: 800, quantityTotal: 10, quantitySold: quantity } });
  const order = await prisma.order.create({
    data: {
      guestEmail: 'buyer@example.com',
      guestName: 'Buyer',
      status: 'paid',
      totalAmount: 800 * quantity,
      paymentMethod: 'redirect',
      prn: 'PRN-1',
      paidAt: new Date(),
      items: { create: [{ ticketTierId: tier.id, quantity, unitPrice: 800 }] },
    },
  });
  return order;
}

describe('fulfillOrder', () => {
  it('creates one Ticket per unit and sends an email', async () => {
    const order = await setupPaidOrder(2);
    await fulfillOrder(order.id);

    const tickets = await prisma.ticket.findMany({ where: { orderItem: { orderId: order.id } } });
    expect(tickets.length).toBe(2);
    expect(tickets.every((t) => t.status === 'valid')).toBe(true);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendMail).mock.calls[0][1];
    expect(call.to).toBe('buyer@example.com');
    expect(call.attachments?.length).toBe(2);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('fulfilled');
    expect(updated.fulfilledAt).toBeTruthy();
  });

  it('leaves the order paid (not fulfilled) if email sending fails, without throwing', async () => {
    const order = await setupPaidOrder(1);
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('SMTP down'));

    await expect(fulfillOrder(order.id)).resolves.not.toThrow();

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');

    // Tickets were still created and are valid — buyer isn't blocked, just needs a resend.
    const tickets = await prisma.ticket.findMany({ where: { orderItem: { orderId: order.id } } });
    expect(tickets.length).toBe(1);
  });

  it('does not create duplicate tickets if called twice (idempotent re-fulfillment/resend)', async () => {
    const order = await setupPaidOrder(1);
    await fulfillOrder(order.id);
    await fulfillOrder(order.id);

    const tickets = await prisma.ticket.findMany({ where: { orderItem: { orderId: order.id } } });
    expect(tickets.length).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(2); // resend still re-sends the email, just doesn't re-mint tickets
  });

  it('emails the account address for a logged-in buyer, not just guestEmail', async () => {
    const buyer = await prisma.buyer.create({ data: { email: 'account-holder@example.com', name: 'Account Holder' } });
    const organizer = await prisma.organizer.create({ data: { email: 'o2@example.com', passwordHash: 'x', name: 'O' } });
    const event = await prisma.event.create({ data: { organizerId: organizer.id, title: 'Show', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' } });
    const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'General', price: 800, quantityTotal: 10, quantitySold: 1 } });
    const order = await prisma.order.create({
      data: {
        buyerId: buyer.id, // no guestEmail — this is the logged-in-buyer path
        status: 'paid',
        totalAmount: 800,
        paymentMethod: 'redirect',
        prn: 'PRN-BUYER-1',
        paidAt: new Date(),
        items: { create: [{ ticketTierId: tier.id, quantity: 1, unitPrice: 800 }] },
      },
    });

    await fulfillOrder(order.id);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendMail).mock.calls[0][1];
    expect(call.to).toBe('account-holder@example.com');
  });

  it('does not double-mint tickets when called concurrently for the same order', async () => {
    const order = await setupPaidOrder(2);
    await Promise.all([fulfillOrder(order.id), fulfillOrder(order.id)]);

    const tickets = await prisma.ticket.count({ where: { orderItem: { orderId: order.id } } });
    expect(tickets).toBe(2);
  });

  it('does not overwrite a refunded order back to fulfilled', async () => {
    const order = await setupPaidOrder(1);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });

    await fulfillOrder(order.id);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('refunded');
  });
});
