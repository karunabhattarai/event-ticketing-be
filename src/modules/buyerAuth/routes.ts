import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { hashPassword, verifyPassword, signJwt, authCookieOptions } from '../../lib/auth';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../env';

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

buyerAuthRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.buyer.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'Email already registered');

    const passwordHash = await hashPassword(body.password);
    const buyer = await prisma.buyer.create({
      data: { email: body.email, passwordHash, name: body.name },
    });

    const token = signJwt({ id: buyer.id }, env.buyerJwtSecret);
    res.cookie('buyer_token', token, authCookieOptions());
    res.status(201).json({ id: buyer.id, email: buyer.email, name: buyer.name });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

buyerAuthRouter.post('/login', async (req, res, next) => {
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
