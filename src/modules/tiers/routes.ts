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
  salesStartAt: z.string().datetime().nullable().optional(),
  salesEndAt: z.string().datetime().nullable().optional(),
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
        salesStartAt: body.salesStartAt === undefined ? undefined : body.salesStartAt ? new Date(body.salesStartAt) : null,
        salesEndAt: body.salesEndAt === undefined ? undefined : body.salesEndAt ? new Date(body.salesEndAt) : null,
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
    const existingTier = await getOwnedTierOrThrow(req.params.eventId, req.params.tierId, req.organizerId!);
    if (body.quantityTotal !== undefined && body.quantityTotal < existingTier.quantitySold) {
      throw new AppError(400, `quantityTotal cannot be less than quantitySold (${existingTier.quantitySold})`);
    }

    const data = {
      ...body,
      salesStartAt: body.salesStartAt === undefined ? undefined : body.salesStartAt ? new Date(body.salesStartAt) : null,
      salesEndAt: body.salesEndAt === undefined ? undefined : body.salesEndAt ? new Date(body.salesEndAt) : null,
    };

    if (body.quantityTotal !== undefined) {
      // Conditional atomic update, not read-then-write: re-checks quantitySold as part
      // of the same statement that performs the write, so a checkout that increments
      // quantitySold between the pre-check above and this write can't land the tier in
      // an oversold-looking state (quantityTotal < quantitySold).
      const result = await prisma.ticketTier.updateMany({
        where: { id: req.params.tierId, quantitySold: { lte: body.quantityTotal } },
        data,
      });
      if (result.count === 0) {
        throw new AppError(409, 'quantityTotal conflicts with a concurrent change to quantitySold — please retry');
      }
    } else {
      await prisma.ticketTier.update({ where: { id: req.params.tierId }, data });
    }

    const tier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: req.params.tierId } });
    res.status(200).json(tier);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});
