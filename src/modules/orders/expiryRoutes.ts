import { Router } from 'express';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../env';
import { expireStalePendingOrders } from './expiry';
import { safeCompare } from '../../lib/safeCompare';

export const expiryRouter = Router();

expiryRouter.post('/expire', async (req, res, next) => {
  try {
    const secret = req.header('X-Cron-Secret');
    if (!secret || !safeCompare(secret, env.cronSecret)) throw new AppError(403, 'Forbidden');

    const result = await expireStalePendingOrders();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
