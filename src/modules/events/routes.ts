import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireOrganizer } from '../../middleware/requireOrganizer';
import { AppError } from '../../middleware/errorHandler';
import { getOwnedEventOrThrow } from './service';

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  venue: z.string().min(1),
  startsAt: z.string().datetime(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  venue: z.string().min(1).optional(),
  startsAt: z.string().datetime().optional(),
  status: z.enum(['draft', 'published', 'cancelled']).optional(),
});

export const eventsRouter = Router();

eventsRouter.post('/', requireOrganizer, async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const event = await prisma.event.create({
      data: { ...body, startsAt: new Date(body.startsAt), organizerId: req.organizerId! },
    });
    res.status(201).json(event);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

eventsRouter.patch('/:id', requireOrganizer, async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    await getOwnedEventOrThrow(req.params.id, req.organizerId!);

    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: { ...body, startsAt: body.startsAt ? new Date(body.startsAt) : undefined },
    });
    res.status(200).json(event);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

eventsRouter.get('/mine', requireOrganizer, async (req, res, next) => {
  try {
    // include tiers — the organizer dashboard's per-event sold-count display
    // (frontend plan Task 12) needs quantitySold/quantityTotal per tier here.
    const events = await prisma.event.findMany({
      where: { organizerId: req.organizerId! },
      include: { tiers: true },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(events);
  } catch (err) {
    next(err);
  }
});

// Registered before GET /:id — Express matches routes in declaration order,
// and '/mine/stats' would otherwise be swallowed by the generic '/:id'
// handler below (same reasoning as '/mine' itself, see the note above).
eventsRouter.get('/mine/stats', requireOrganizer, async (req, res, next) => {
  try {
  // Organizer-wide dashboard tiles (spec UI screen 7: "tickets sold, revenue,
  // checked-in"), aggregated across every event the organizer owns — distinct
  // from Task 17's GET /events/:eventId/orders stats, which is scoped to one event.
  //
  // ticketsSold counts Ticket rows, not TicketTier.quantitySold — quantitySold
  // is a reservation counter incremented at checkout time and includes
  // abandoned/pending orders, which would make "sold" and "revenue" disagree
  // (e.g. "10 sold, Rs. 0 revenue" for 10 abandoned carts). Ticket rows only
  // exist once fulfillOrder has run, i.e. after payment succeeded.
  //
  // revenue sums OrderItem.quantity * unitPrice restricted to this organizer's
  // own tiers, not Order.totalAmount — totalAmount is the whole order's total,
  // which today always belongs to one event/organizer only because checkout
  // rejects multi-event carts (Task 12), but that's an invariant this query
  // shouldn't have to rely on. Summed in JS since Prisma's aggregate can't
  // compute a per-row quantity*unitPrice product.
  const [paidItems, ticketsSold, ticketsCheckedIn] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        ticketTier: { event: { organizerId: req.organizerId! } },
        order: { status: { in: ['paid', 'fulfilled'] } },
      },
      select: { quantity: true, unitPrice: true },
    }),
    prisma.ticket.count({
      where: {
        status: { in: ['valid', 'used'] },
        orderItem: { ticketTier: { event: { organizerId: req.organizerId! } } },
      },
    }),
    prisma.ticket.count({
      where: { status: 'used', orderItem: { ticketTier: { event: { organizerId: req.organizerId! } } } },
    }),
  ]);

  const revenue = paidItems.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);

  res.status(200).json({
    ticketsSold,
    revenue: revenue.toString(),
    ticketsCheckedIn,
  });
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/', async (_req, res, next) => {
  try {
    // include tiers — the public listing page's EventCard needs tier prices
    // to render "From Rs. X" (frontend plan Task 3).
    const events = await prisma.event.findMany({
      where: { status: 'published' },
      include: { tiers: true },
      orderBy: { startsAt: 'asc' },
    });
    res.status(200).json(events);
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:id', async (req, res, next) => {
  try {
    const event = await prisma.event.findFirst({
      where: { id: req.params.id, status: 'published' },
      include: { tiers: true },
    });
    if (!event) throw new AppError(404, 'Event not found');
    res.status(200).json(event);
  } catch (err) {
    next(err);
  }
});
