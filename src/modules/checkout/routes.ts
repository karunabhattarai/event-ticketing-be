import { Router } from 'express';
import { z } from 'zod';
import { requireBuyerOptional } from '../../middleware/requireBuyerOptional';
import { AppError } from '../../middleware/errorHandler';
import { createOrder } from './service';

const checkoutSchema = z.object({
  items: z.array(z.object({ tierId: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  guestEmail: z.string().email().optional(),
  guestName: z.string().min(1).optional(),
  paymentMethod: z.enum(['redirect', 'dynamic_qr']),
});

export const checkoutRouter = Router();

checkoutRouter.post('/', requireBuyerOptional, async (req, res, next) => {
  try {
    const body = checkoutSchema.parse(req.body);
    if (!req.buyerId && (!body.guestEmail || !body.guestName)) {
      throw new AppError(400, 'guestEmail and guestName are required for guest checkout');
    }

    const order = await createOrder({
      items: body.items,
      buyerId: req.buyerId,
      guestEmail: body.guestEmail,
      guestName: body.guestName,
      paymentMethod: body.paymentMethod,
    });

    res.status(201).json(order);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});
