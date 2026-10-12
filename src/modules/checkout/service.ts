import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import crypto from 'crypto';

type CheckoutItem = { tierId: string; quantity: number };

export async function createOrder(params: {
  items: CheckoutItem[];
  buyerId?: string;
  guestEmail?: string;
  guestName?: string;
  paymentMethod: 'redirect' | 'dynamic_qr';
}) {
  const tierIds = params.items.map((i) => i.tierId);
  const tiers = await prisma.ticketTier.findMany({
    where: { id: { in: tierIds } },
    include: { event: true },
  });

  if (tiers.length !== tierIds.length) throw new AppError(404, 'One or more ticket tiers not found');

  const eventIds = new Set(tiers.map((t) => t.eventId));
  if (eventIds.size > 1) throw new AppError(400, 'All items in one order must belong to the same event');

  const event = tiers[0].event;
  if (event.status !== 'published') throw new AppError(400, 'Event is not available for purchase');

  const now = new Date();
  if (event.startsAt < now) throw new AppError(400, 'Event has already taken place');

  for (const item of params.items) {
    const tier = tiers.find((t) => t.id === item.tierId)!;
    if (tier.salesStartAt && tier.salesStartAt > now) {
      throw new AppError(400, `Sales for ${tier.name} have not started yet`);
    }
    if (tier.salesEndAt && tier.salesEndAt < now) {
      throw new AppError(400, `Sales for ${tier.name} have ended`);
    }
  }

  const prn = `ORDER-${crypto.randomUUID()}`;

  const order = await prisma.$transaction(async (tx) => {
    // Re-read each tier's price/quantityTotal inside the transaction, right before
    // reserving stock, instead of trusting the `tiers` snapshot fetched above — an
    // organizer's concurrent PATCH /tiers/:tierId (price or quantityTotal change)
    // between that snapshot and this transaction would otherwise leave the stock
    // check and the order total built from stale values.
    const freshTiers = new Map<string, { name: string; price: Prisma.Decimal; quantityTotal: number }>();
    for (const item of params.items) {
      const staleTier = tiers.find((t) => t.id === item.tierId)!;
      const freshTier = freshTiers.has(item.tierId)
        ? freshTiers.get(item.tierId)!
        : await tx.ticketTier.findUniqueOrThrow({ where: { id: item.tierId } });
      freshTiers.set(item.tierId, freshTier);

      // Conditional atomic update, not read-then-write: the WHERE clause re-checks
      // remaining stock as part of the same statement Postgres uses to acquire the
      // row lock, so two concurrent transactions can't both pass a stale read and
      // both increment past quantityTotal (which plain findUniqueOrThrow + update
      // would allow under READ COMMITTED, Prisma's default transaction isolation).
      const result = await tx.ticketTier.updateMany({
        where: {
          id: item.tierId,
          quantitySold: { lte: freshTier.quantityTotal - item.quantity },
        },
        data: { quantitySold: { increment: item.quantity } },
      });
      if (result.count === 0) {
        throw new AppError(409, `Not enough tickets remaining for ${staleTier.name}`);
      }
    }

    let totalAmount = new Prisma.Decimal(0);
    for (const item of params.items) {
      const freshTier = freshTiers.get(item.tierId)!;
      totalAmount = totalAmount.add(freshTier.price.mul(item.quantity));
    }

    return tx.order.create({
      data: {
        buyerId: params.buyerId,
        guestEmail: params.guestEmail,
        guestName: params.guestName,
        status: 'pending',
        totalAmount,
        paymentMethod: params.paymentMethod,
        prn,
        items: {
          create: params.items.map((item) => {
            const freshTier = freshTiers.get(item.tierId)!;
            return { ticketTierId: item.tierId, quantity: item.quantity, unitPrice: freshTier.price };
          }),
        },
      },
      include: { items: true },
    });
  });

  return order;
}

// Combines the pending->failed claim with the stock release in one transaction, so a
// crash between "mark failed" and "release stock" is impossible — either both happen
// or neither does. Returns whether this call won the claim (false = already settled
// by a concurrent caller, a safe no-op).
export async function claimFailedAndRelease(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'failed' },
    });
    if (claim.count === 0) return false;

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    for (const item of order.items) {
      await tx.ticketTier.update({
        where: { id: item.ticketTierId },
        data: { quantitySold: { decrement: item.quantity } },
      });
    }
    return true;
  });
}
