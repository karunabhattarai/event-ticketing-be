import { Router } from 'express';
import { prisma } from '../../db/client';
import { requireOrganizer } from '../../middleware/requireOrganizer';
import { AppError } from '../../middleware/errorHandler';
import { verifyTicketCode } from '../../lib/ticketCode';

export const checkinRouter = Router();

checkinRouter.post('/:code', requireOrganizer, async (req, res, next) => {
  try {
    const decoded = verifyTicketCode(req.params.code);
    if (!decoded) throw new AppError(400, 'Invalid ticket code');

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: decoded.ticketId,
        orderItem: { ticketTier: { eventId: decoded.eventId, event: { organizerId: req.organizerId! } } },
      },
      include: { orderItem: { include: { order: { include: { buyer: true } }, ticketTier: true } } },
    });
    if (!ticket) throw new AppError(404, 'Ticket not found for your events');

    // Atomic check-and-mark — never a separate read-then-write (Global Constraints).
    const { count } = await prisma.ticket.updateMany({
      where: { id: ticket.id, status: 'valid' },
      data: { status: 'used', checkedInAt: new Date(), checkedInBy: req.organizerId! },
    });

    if (count === 0) {
      const current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      if (current.status === 'used') {
        res.status(409).json({ result: 'already_used', checkedInAt: current.checkedInAt });
        return;
      }
      throw new AppError(400, 'Ticket is void');
    }

    res.status(200).json({
      result: 'valid',
      // guestName is only set for guest checkout — a logged-in buyer's order
      // has buyerId set instead (same fallback pattern as fulfillOrder, Task 15).
      holderName: ticket.orderItem.order.guestName ?? ticket.orderItem.order.buyer?.name ?? null,
      tierName: ticket.orderItem.ticketTier.name,
    });
  } catch (err) {
    next(err);
  }
});
