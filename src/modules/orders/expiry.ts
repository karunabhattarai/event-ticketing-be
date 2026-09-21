import { checkStatus, checkDynamicQrStatus } from '@arbyte-solutions/fonepay-service';
import { prisma } from '../../db/client';
import { claimFailedAndRelease } from '../checkout/service';
import { fulfillOrder } from '../fulfillment/service';
import { env } from '../../env';

const fonepayConfig = {
  merchantCode: env.fonepay.merchantCode,
  secretKey: env.fonepay.secretKey,
  baseUrl: env.fonepay.baseUrl,
};

const qrConfig = {
  merchantCode: env.fonepay.merchantCode,
  secretKey: env.fonepay.secretKey,
  baseUrl: env.fonepay.baseUrl,
  username: env.fonepay.qrUsername,
  password: env.fonepay.qrPassword,
  qrBaseUrl: env.fonepay.qrBaseUrl,
};

async function claimAndSettle(orderId: string, outcome: 'paid' | 'failed'): Promise<boolean> {
  // Same atomic-claim shape as the payment handlers (Tasks 13-14) — the sweep
  // runs concurrently with live buyer traffic, so an order can transition out
  // of 'pending' between the query that found it stale and this update.
  if (outcome === 'failed') {
    return claimFailedAndRelease(orderId);
  }
  const claim = await prisma.order.updateMany({
    where: { id: orderId, status: 'pending' },
    data: { status: 'paid', paidAt: new Date() },
  });
  if (claim.count === 0) return false;
  await fulfillOrder(orderId);
  return true;
}

export async function expireStalePendingOrders(): Promise<{ checked: number; expired: number; failed: number }> {
  const cutoff = new Date(Date.now() - env.orderExpiryMinutes * 60 * 1000);
  const staleOrders = await prisma.order.findMany({
    where: { status: 'pending', createdAt: { lt: cutoff } },
  });

  let expired = 0;
  let failed = 0;

  for (const order of staleOrders) {
    try {
      if (order.paymentMethod === 'dynamic_qr') {
        const result = await checkDynamicQrStatus(qrConfig, { prn: order.prn });
        if (result.paymentStatus === 'success') {
          await claimAndSettle(order.id, 'paid');
        } else {
          const settled = await claimAndSettle(order.id, 'failed');
          if (settled) expired++;
        }
        continue;
      }

      // redirect method — can only reconcile if a callback already stored bankCode/uid
      if (order.fonepayBankCode && order.fonepayUid) {
        const result = await checkStatus(fonepayConfig, {
          prn: order.prn,
          amount: Number(order.totalAmount),
          bankCode: order.fonepayBankCode,
          uid: order.fonepayUid,
        });
        if (result.RC === 'successful') {
          await claimAndSettle(order.id, 'paid');
          continue;
        }
      }

      const settled = await claimAndSettle(order.id, 'failed');
      if (settled) expired++;
    } catch (err) {
      console.error(`expireStalePendingOrders: order ${order.id} failed to reconcile`, err);
      failed++;
    }
  }

  return { checked: staleOrders.length, expired, failed };
}
