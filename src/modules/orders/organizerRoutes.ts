import { Router } from 'express';
import { prisma } from '../../db/client';
import { requireOrganizer } from '../../middleware/requireOrganizer';
import { AppError } from '../../middleware/errorHandler';
import { getOwnedEventOrThrow } from '../events/service';
import { fulfillOrder } from '../fulfillment/service';
import { resendRateLimiter } from '../../middleware/rateLimiters';

export const organizerOrdersRouter = Router({ mergeParams: true });

organizerOrdersRouter.get('/', requireOrganizer, async (req, res, next) => {
  try {
    await getOwnedEventOrThrow(req.params.eventId, req.organizerId!);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const where = { items: { some: { ticketTier: { eventId: req.params.eventId } } } };

    const [orders, statusGroups, ticketsIssued, ticketsCheckedIn] = await Promise.all([
      prisma.order.findMany({
        where,
        select: {
          id: true,
          buyerId: true,
          guestEmail: true,
          guestName: true,
          status: true,
          totalAmount: true,
          currency: true,
          paymentMethod: true,
          createdAt: true,
          paidAt: true,
          fulfilledAt: true,
          items: { include: { ticketTier: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // Dashboard tiles are organizer-wide/event-wide, not page-scoped — computed
      // over the FULL matching set via groupBy, independent of the paginated
      // `orders` query above.
      prisma.order.groupBy({ by: ['status'], where, _count: true }),
      prisma.ticket.count({ where: { orderItem: { ticketTier: { eventId: req.params.eventId } } } }),
      prisma.ticket.count({ where: { orderItem: { ticketTier: { eventId: req.params.eventId } }, status: 'used' } }),
    ]);

    const statusCounts = { pending: 0, paid: 0, fulfilled: 0, failed: 0, refunded: 0 };
    for (const group of statusGroups) statusCounts[group.status] = group._count;

    res.status(200).json({ orders, stats: { ...statusCounts, ticketsIssued, ticketsCheckedIn } });
  } catch (err) {
    next(err);
  }
});

organizerOrdersRouter.post('/:orderId/resend', requireOrganizer, resendRateLimiter, async (req, res, next) => {
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

    const result = await fulfillOrder(order.id);
    if (!result.emailSent) throw new AppError(502, 'Failed to send ticket email — please try again shortly');
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

organizerOrdersRouter.post('/:orderId/refund', requireOrganizer, async (req, res, next) => {
  try {
    await getOwnedEventOrThrow(req.params.eventId, req.organizerId!);

    // Same event-scoping as resend, above — an owned eventId doesn't imply
    // ownership of an arbitrary orderId.
    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, items: { some: { ticketTier: { eventId: req.params.eventId } } } },
    });
    if (!order) throw new AppError(404, 'Order not found');
    // Only a paid/fulfilled order actually reserved stock and issued
    // tickets worth reversing — refunding a pending/failed order would
    // mark it refunded without ever releasing its reservation, and the
    // expiry sweep (Task 21) only ever looks at status='pending', so that
    // stock would never be released.
    if (order.status !== 'paid' && order.status !== 'fulfilled') {
      throw new AppError(400, 'Only a paid or fulfilled order can be refunded');
    }

    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } }),
      prisma.ticket.updateMany({
        where: { orderItem: { orderId: order.id }, status: 'valid' },
        data: { status: 'void' },
      }),
    ]);

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
