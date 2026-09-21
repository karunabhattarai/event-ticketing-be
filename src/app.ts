import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { env } from './env';
import { organizerAuthRouter } from './modules/organizerAuth/routes';
import { buyerAuthRouter } from './modules/buyerAuth/routes';
import { buyerOrdersRouter } from './modules/buyerAuth/ordersRoutes';
import { eventsRouter } from './modules/events/routes';
import { tiersRouter } from './modules/tiers/routes';
import { checkoutRouter } from './modules/checkout/routes';
import { redirectPaymentRouter } from './modules/payment/redirect';
import { dynamicQrPaymentRouter } from './modules/payment/dynamicQr';
import { orderStatusRouter } from './modules/orders/statusRoutes';
import { organizerOrdersRouter } from './modules/orders/organizerRoutes';
import { checkinRouter } from './modules/checkin/routes';

export function createApp(): Express {
  const app = express();
  // credentials:true + an explicit origin (never '*') — the frontend runs on a
  // different port (Vite dev server) and must send/receive the auth cookies.
  app.use(cors({ origin: env.appBaseUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/organizer/auth', organizerAuthRouter);
  app.use('/buyer/auth', buyerAuthRouter);
  app.use('/buyer/orders', buyerOrdersRouter);
  app.use('/events', eventsRouter);
  app.use('/events/:eventId/tiers', tiersRouter);
  app.use('/checkout', checkoutRouter);
  app.use('/payment/redirect', redirectPaymentRouter);
  app.use('/payment/dynamic-qr', dynamicQrPaymentRouter);
  app.use('/orders', orderStatusRouter);
  app.use('/events/:eventId/orders', organizerOrdersRouter);
  app.use('/checkin', checkinRouter);

  app.use(errorHandler);
  return app;
}
