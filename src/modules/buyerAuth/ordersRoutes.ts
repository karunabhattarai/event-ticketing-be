import { Router } from 'express';
import { prisma } from '../../db/client';
import { requireBuyer } from '../../middleware/requireBuyer';

export const buyerOrdersRouter = Router();

buyerOrdersRouter.get('/', requireBuyer, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { buyerId: req.buyerId! },
      include: { items: { include: { ticketTier: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(orders);
  } catch (err) {
    next(err);
  }
});
