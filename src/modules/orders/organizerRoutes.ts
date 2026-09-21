import { Router } from 'express';
import { prisma } from '../../db/client';
import { requireOrganizer } from '../../middleware/requireOrganizer';
import { AppError } from '../../middleware/errorHandler';
import { getOwnedEventOrThrow } from '../events/service';
import { fulfillOrder } from '../fulfillment/service';

export const organizerOrdersRouter = Router({ mergeParams: true });

organizerOrdersRouter.get('/', requireOrganizer, async (req, res, next) => {
  try {
    await getOwnedEventOrThrow(req.params.eventId, req.organizerId!);

    const orders = await prisma.order.findMany({
      where: { items: { some: { ticketTier: { eventId: req.params.eventId } } } },
      include: { items: { include: { ticketTier: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const statusCounts = { pending: 0, paid: 0, fulfilled: 0, failed: 0, refunded: 0 };
    for (const order of orders) statusCounts[order.status]++;

    const [ticketsIssued, ticketsCheckedIn] = await Promise.all([
      prisma.ticket.count({ where: { orderItem: { ticketTier: { eventId: req.params.eventId } } } }),
      prisma.ticket.count({ where: { orderItem: { ticketTier: { eventId: req.params.eventId } }, status: 'used' } }),
    ]);

    res.status(200).json({ orders, stats: { ...statusCounts, ticketsIssued, ticketsCheckedIn } });
  } catch (err) {
    next(err);
  }
});

organizerOrdersRouter.post('/:orderId/resend', requireOrganizer, async (req, res, next) => {
  try {
    await getOwnedEventOrThrow(req.params.eventId, req.organizerId!);

    // Scoped to this event, not just "any order with this id" — an
    // organizer owning eventId doesn't imply they own an arbitrary orderId
    // (an order id from a different organizer's event is a valid UUID and
    // would otherwise pass findUnique with no ownership check at all).
    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, items: { some: { ticketTier: { eventId: req.params.eventId } } } },
    });
    if (!order) throw new AppError(404, 'Order not found');
    if (order.status !== 'paid' && order.status !== 'fulfilled') {
      throw new AppError(400, 'Order has not been paid — nothing to resend');
    }

    await fulfillOrder(order.id);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
