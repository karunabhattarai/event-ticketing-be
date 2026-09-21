import { Router } from 'express';
import QRCode from 'qrcode';
import {
  generateDynamicQr,
  checkDynamicQrStatus,
  subscribeDynamicQrStatus,
} from '@arbyte-solutions/fonepay-service';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { claimFailedAndRelease } from '../checkout/service';
import { fulfillOrder } from '../fulfillment/service';
import { env } from '../../env';

export const dynamicQrPaymentRouter = Router();

const qrConfig = {
  merchantCode: env.fonepay.merchantCode,
  secretKey: env.fonepay.secretKey,
  baseUrl: env.fonepay.baseUrl,
  username: env.fonepay.qrUsername,
  password: env.fonepay.qrPassword,
  qrBaseUrl: env.fonepay.qrBaseUrl,
};

async function settleOrder(orderId: string, outcome: 'paid' | 'failed') {
  // Atomic claim, same reasoning as the redirect return handler: the websocket
  // callback and a concurrent GET /status poll can both observe 'pending' and both
  // try to settle this order at nearly the same moment. updateMany's WHERE
  // re-checks status='pending' as part of the row-locking statement itself, so
  // only one of the two ever gets count === 1 — the loser is a safe no-op instead
  // of a second releaseReservation/fulfillOrder call.
  if (outcome === 'failed') {
    await claimFailedAndRelease(orderId);
    return;
  }
  const claim = await prisma.order.updateMany({
    where: { id: orderId, status: 'pending' },
    data: { status: 'paid', paidAt: new Date() },
  });
  if (claim.count === 1) await fulfillOrder(orderId);
}

dynamicQrPaymentRouter.post('/:orderId/generate', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    if (!order || order.accessToken !== req.query.token) throw new AppError(403, 'Forbidden');
    if (order.status !== 'pending') throw new AppError(400, 'Order is not pending payment');

    const qr = await generateDynamicQr(qrConfig, {
      amount: Number(order.totalAmount),
      prn: order.prn,
      remarks1: `Order ${order.id}`,
    });

    // Websocket primary path — best-effort, fallback polling covers a dropped socket.
    let closeTimer: NodeJS.Timeout;
    const { close } = subscribeDynamicQrStatus(qr.thirdpartyQrWebSocketUrl, {
      onPaymentSuccess: () => {
        // Explicit .catch — this runs outside any request's try/catch, so an
        // unhandled rejection here (e.g. a DB blip during fulfillOrder) would
        // otherwise crash the whole process under Node's default behavior.
        // GET /status's polling fallback still resolves the order even if
        // this particular attempt fails.
        settleOrder(order.id, 'paid')
          .catch((err) => console.error(`websocket settleOrder failed for order ${order.id}`, err))
          .finally(() => {
            clearTimeout(closeTimer);
            close();
          });
      },
      onError: () => {
        // swallow the payment-status implication — GET /status's polling fallback
        // will resolve this order — but still release the socket, which onError
        // otherwise leaks indefinitely.
        clearTimeout(closeTimer);
        close();
      },
    });

    // No success/error event may ever fire (buyer abandons the checkout) — close
    // the socket once the QR's own advertised validity window elapses, so an
    // abandoned checkout doesn't leak an open websocket for the life of the process.
    closeTimer = setTimeout(() => close(), env.orderExpiryMinutes * 60 * 1000);

    const qrImageDataUrl = await QRCode.toDataURL(qr.qrMessage);
    res.status(200).json({ qrImageDataUrl, expiresInSeconds: env.orderExpiryMinutes * 60 });
  } catch (err) {
    next(err);
  }
});

dynamicQrPaymentRouter.get('/:orderId/status', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    if (!order || order.accessToken !== req.query.token) throw new AppError(403, 'Forbidden');

    if (order.status !== 'pending') {
      res.status(200).json({ status: order.status });
      return;
    }

    // Fallback poll — only reached while still pending (Global Constraints: websocket primary + poll fallback).
    const result = await checkDynamicQrStatus(qrConfig, { prn: order.prn });
    if (result.paymentStatus === 'success') {
      await settleOrder(order.id, 'paid');
    } else if (result.paymentStatus === 'failed') {
      await settleOrder(order.id, 'failed');
    }

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    res.status(200).json({ status: updated.status });
  } catch (err) {
    next(err);
  }
});
