import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { hashPassword, verifyPassword, signJwt, authCookieOptions } from '../../lib/auth';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../env';
import { authRateLimiter } from '../../middleware/rateLimiters';
import { isUniqueConstraintError } from '../../lib/prismaErrors';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const buyerAuthRouter = Router();

buyerAuthRouter.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.buyer.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'Email already registered');

    const passwordHash = await hashPassword(body.password);
    let buyer;
    try {
      buyer = await prisma.buyer.create({
        data: { email: body.email, passwordHash, name: body.name },
      });
    } catch (createErr) {
      // Two concurrent registrations for the same email can both pass the findUnique
      // check above before either creates a row — the DB's unique constraint is the
      // real guard, and P2002 here means the race was lost, not a server error.
      if (isUniqueConstraintError(createErr)) {
        throw new AppError(409, 'Email already registered');
      }
      throw createErr;
    }

    const token = signJwt({ id: buyer.id }, env.buyerJwtSecret);
    res.cookie('buyer_token', token, authCookieOptions());
    res.status(201).json({ id: buyer.id, email: buyer.email, name: buyer.name });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

buyerAuthRouter.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const buyer = await prisma.buyer.findUnique({ where: { email: body.email } });
    if (!buyer || !buyer.passwordHash) throw new AppError(401, 'Invalid email or password');

    const valid = await verifyPassword(body.password, buyer.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid email or password');

    const token = signJwt({ id: buyer.id }, env.buyerJwtSecret);
    res.cookie('buyer_token', token, authCookieOptions());
    res.status(200).json({ id: buyer.id, email: buyer.email, name: buyer.name });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

buyerAuthRouter.post('/logout', (req, res) => {
  // sameSite/secure must match the cookie's original options for clearCookie to
  // actually clear it in all browsers; maxAge is dropped since Express deprecates
  // (and ignores) it here — clearCookie already expires the cookie immediately.
  const { maxAge, ...clearOptions } = authCookieOptions();
  res.clearCookie('buyer_token', clearOptions);
  res.status(200).json({ ok: true });
});
