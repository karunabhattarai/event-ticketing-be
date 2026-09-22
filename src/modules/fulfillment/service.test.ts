import { describe, it, expect, beforeEach, vi } from 'vitest';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

vi.mock('@arbyte-solutions/mail-service', () => ({
  sendMail: vi.fn(async () => {}),
}));

vi.mock('../../lib/ticketCode', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ticketCode')>('../../lib/ticketCode');
  return { ...actual, signTicketCode: vi.fn(actual.signTicketCode) };
});

import { sendMail } from '@arbyte-solutions/mail-service';
import { signTicketCode } from '../../lib/ticketCode';
import { fulfillOrder } from './service';

beforeEach(async () => {
  await truncateAll();
  vi.mocked(sendMail).mockClear();
  vi.mocked(signTicketCode).mockClear();
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

  it('escapes HTML in tier name and event title before putting them in the ticket email', async () => {
    const organizer = await prisma.organizer.create({ data: { email: 'o2@example.com', passwordHash: 'x', name: 'O' } });
    const event = await prisma.event.create({
      data: { organizerId: organizer.id, title: '<img src=x onerror=alert(1)>', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: '<script>evil</script>', price: 800, quantityTotal: 10, quantitySold: 1 },
    });
    const order = await prisma.order.create({
      data: {
        guestEmail: 'buyer2@example.com',
        guestName: 'Buyer',
        status: 'paid',
        totalAmount: 800,
        paymentMethod: 'redirect',
        prn: 'PRN-ESCAPE',
        paidAt: new Date(),
        items: { create: [{ ticketTierId: tier.id, quantity: 1, unitPrice: 800 }] },
      },
    });

    await fulfillOrder(order.id);

    const call = vi.mocked(sendMail).mock.calls[0][1];
    expect(call.html).not.toContain('<script>evil</script>');
    expect(call.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(call.html).toContain('&lt;script&gt;evil&lt;/script&gt;');
    expect(call.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
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

  it('does not leave the order stuck half-minted if minting throws mid-transaction', async () => {
    // Two separate order items so the mint loop makes two signTicketCode calls;
    // fail on the second one to simulate a mid-transaction error after the first
    // ticket's code has already been computed (but not yet committed, since the
    // createMany happens after the whole rows array is built).
    const organizer = await prisma.organizer.create({ data: { email: 'o3@example.com', passwordHash: 'x', name: 'O' } });
    const event = await prisma.event.create({ data: { organizerId: organizer.id, title: 'Show', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' } });
    const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'General', price: 800, quantityTotal: 10, quantitySold: 2 } });
    const order = await prisma.order.create({
      data: {
        guestEmail: 'buyer3@example.com',
        guestName: 'Buyer',
        status: 'paid',
        totalAmount: 1600,
        paymentMethod: 'redirect',
        prn: 'PRN-MIDFAIL',
        paidAt: new Date(),
        items: {
          create: [
            { ticketTierId: tier.id, quantity: 1, unitPrice: 800 },
            { ticketTierId: tier.id, quantity: 1, unitPrice: 800 },
          ],
        },
      },
    });

    // First call succeeds normally (real implementation), second call throws,
    // simulating a mid-transaction failure after part of the mint loop has run.
    const actual = vi.mocked(signTicketCode).getMockImplementation();
    let callCount = 0;
    vi.mocked(signTicketCode).mockImplementation((id: string, eventId: string) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('simulated mid-mint failure');
      }
      return actual ? actual(id, eventId) : `sig-${id}-${eventId}`;
    });

    await expect(fulfillOrder(order.id)).rejects.toThrow('simulated mid-mint failure');

    const afterFailure = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterFailure.fulfilledAt).toBeNull();
    expect(afterFailure.status).toBe('paid');
    const ticketsAfterFailure = await prisma.ticket.count({ where: { orderItem: { orderId: order.id } } });
    expect(ticketsAfterFailure).toBe(0);

    // Restore normal behavior and confirm a subsequent call fully succeeds.
    vi.mocked(signTicketCode).mockImplementation(actual ?? ((id: string, eventId: string) => `sig-${id}-${eventId}`));
    await fulfillOrder(order.id);

    const afterSuccess = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterSuccess.fulfilledAt).toBeTruthy();
    const ticketsAfterSuccess = await prisma.ticket.count({ where: { orderItem: { orderId: order.id } } });
    expect(ticketsAfterSuccess).toBe(2);
  });

  it('does not overwrite a refunded order back to fulfilled', async () => {
    const order = await setupPaidOrder(1);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });

    await fulfillOrder(order.id);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('refunded');
  });
});
