import { Router } from 'express';
import { initiatePayment, verifyResponse, FonepayCallbackResponse } from '@arbyte-solutions/fonepay-service';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { claimFailedAndRelease } from '../checkout/service';
import { fulfillOrder } from '../fulfillment/service';
import { env } from '../../env';

export const redirectPaymentRouter = Router();

const fonepayConfig = {
  merchantCode: env.fonepay.merchantCode,
  secretKey: env.fonepay.secretKey,
  baseUrl: env.fonepay.baseUrl,
};

redirectPaymentRouter.post('/:orderId/initiate', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    // Same 403-for-both-cases shape as GET /orders/:id (Task 16) — order ids
    // aren't secret (they show up in organizer views and URLs), so acting on
    // one requires proving you hold its access token, not just knowing the id.
    if (!order || order.accessToken !== req.query.token) throw new AppError(403, 'Forbidden');
    if (order.status !== 'pending') throw new AppError(400, 'Order is not pending payment');

    // Not retried — initiatePayment is not idempotent (Global Constraints).
    const { url } = initiatePayment(fonepayConfig, {
      amount: Number(order.totalAmount),
      prn: order.prn,
      returnUrl: `${env.backendBaseUrl}/payment/redirect/return`,
      remarks1: `Order ${order.id}`,
    });

    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
});

redirectPaymentRouter.get('/return', async (req, res, next) => {
  try {
    const query = req.query as unknown as FonepayCallbackResponse;
    const order = await prisma.order.findUnique({ where: { prn: query.PRN } });
    if (!order) throw new AppError(404, 'Order not found');

    if (order.status === 'pending') {
      const ok = verifyResponse(env.fonepay.secretKey, query);
      // Atomic claim: updateMany's WHERE re-checks status='pending' as part of the
      // same statement that acquires the row lock, so two concurrent callbacks for
      // the same order (a double-loaded return URL, or this racing a QR poll) can't
      // both see 'pending' and both settle the order — only the first claims it.
      if (ok) {
        const claim = await prisma.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: { status: 'paid', paidAt: new Date(), fonepayUid: query.UID, fonepayBankCode: query.BC },
        });
        if (claim.count === 1) await fulfillOrder(order.id);
      } else {
        await claimFailedAndRelease(order.id);
      }
    }

    res.redirect(302, `${env.appBaseUrl}/order/${order.id}/status?token=${order.accessToken}`);
  } catch (err) {
    next(err);
  }
});
