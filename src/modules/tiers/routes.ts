import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireOrganizer } from '../../middleware/requireOrganizer';
import { AppError } from '../../middleware/errorHandler';
import { getOwnedEventOrThrow } from '../events/service';
import { getOwnedTierOrThrow } from './service';

const createSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  currency: z.string().optional(),
  quantityTotal: z.number().int().positive(),
  salesStartAt: z.string().datetime().optional(),
  salesEndAt: z.string().datetime().optional(),
});

const updateSchema = createSchema.partial();

export const tiersRouter = Router({ mergeParams: true });

tiersRouter.post('/', requireOrganizer, async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    await getOwnedEventOrThrow(req.params.eventId, req.organizerId!);

    const tier = await prisma.ticketTier.create({
      data: {
        eventId: req.params.eventId,
        name: body.name,
        price: body.price,
        currency: body.currency ?? 'NPR',
        quantityTotal: body.quantityTotal,
        salesStartAt: body.salesStartAt ? new Date(body.salesStartAt) : undefined,
        salesEndAt: body.salesEndAt ? new Date(body.salesEndAt) : undefined,
      },
    });
    res.status(201).json(tier);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

tiersRouter.patch('/:tierId', requireOrganizer, async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    await getOwnedTierOrThrow(req.params.eventId, req.params.tierId, req.organizerId!);

    const tier = await prisma.ticketTier.update({
      where: { id: req.params.tierId },
      data: {
        ...body,
        salesStartAt: body.salesStartAt ? new Date(body.salesStartAt) : undefined,
        salesEndAt: body.salesEndAt ? new Date(body.salesEndAt) : undefined,
      },
    });
    res.status(200).json(tier);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});
