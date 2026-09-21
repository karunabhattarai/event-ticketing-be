import { Router } from 'express';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { fulfillOrder } from '../fulfillment/service';

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
    if (!order || order.accessToken !== token) throw new AppError(403, 'Forbidden');

    res.status(200).json(order);
  } catch (err) {
    next(err);
  }
});

orderStatusRouter.post('/:id/resend', async (req, res, next) => {
  try {
    const token = req.query.token;
    if (typeof token !== 'string' || !token) throw new AppError(403, 'Forbidden');

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order || order.accessToken !== token) throw new AppError(403, 'Forbidden');
    if (order.status !== 'paid' && order.status !== 'fulfilled') {
      throw new AppError(400, 'Order has not been paid — nothing to resend');
    }

    await fulfillOrder(order.id);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
