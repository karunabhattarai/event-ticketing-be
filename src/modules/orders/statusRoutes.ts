import { Router } from 'express';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { fulfillOrder } from '../fulfillment/service';
import { resendRateLimiter } from '../../middleware/rateLimiters';
import { safeCompare } from '../../lib/safeCompare';

export const orderStatusRouter = Router();

orderStatusRouter.get('/:id', async (req, res, next) => {
  try {
    const token = req.query.token;
    if (typeof token !== 'string' || !token) throw new AppError(403, 'Forbidden');

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { ticketTier: true } } },
    });

    // Same 403 whether the order doesn't exist or the token is wrong — no id-existence leak.
    if (!order || !safeCompare(order.accessToken, token)) throw new AppError(403, 'Forbidden');

    res.status(200).json(order);
  } catch (err) {
    next(err);
  }
});

orderStatusRouter.post('/:id/resend', resendRateLimiter, async (req, res, next) => {
  try {
    const token = req.query.token;
    if (typeof token !== 'string' || !token) throw new AppError(403, 'Forbidden');

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order || !safeCompare(order.accessToken, token)) throw new AppError(403, 'Forbidden');
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
