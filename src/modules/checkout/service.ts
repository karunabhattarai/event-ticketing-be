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

  let totalAmount = 0;
  for (const item of params.items) {
    const tier = tiers.find((t) => t.id === item.tierId)!;
    totalAmount += Number(tier.price) * item.quantity;
  }

  const prn = `ORDER-${crypto.randomUUID()}`;

  const order = await prisma.$transaction(async (tx) => {
    for (const item of params.items) {
      const tier = tiers.find((t) => t.id === item.tierId)!;
      // Conditional atomic update, not read-then-write: the WHERE clause re-checks
      // remaining stock as part of the same statement Postgres uses to acquire the
      // row lock, so two concurrent transactions can't both pass a stale read and
      // both increment past quantityTotal (which plain findUniqueOrThrow + update
      // would allow under READ COMMITTED, Prisma's default transaction isolation).
      const result = await tx.ticketTier.updateMany({
        where: {
          id: item.tierId,
          quantitySold: { lte: tier.quantityTotal - item.quantity },
        },
        data: { quantitySold: { increment: item.quantity } },
      });
      if (result.count === 0) {
        throw new AppError(409, `Not enough tickets remaining for ${tier.name}`);
      }
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
            const tier = tiers.find((t) => t.id === item.tierId)!;
            return { ticketTierId: item.tierId, quantity: item.quantity, unitPrice: tier.price };
          }),
        },
      },
      include: { items: true },
    });
  });

  return order;
}

export async function releaseReservation(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });

  await prisma.$transaction(
    order.items.map((item) =>
      prisma.ticketTier.update({
        where: { id: item.ticketTierId },
        data: { quantitySold: { decrement: item.quantity } },
      })
    )
  );
}
