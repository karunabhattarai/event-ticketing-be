import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { hashPassword, verifyPassword, signJwt, authCookieOptions } from '../../lib/auth';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../env';
import { authRateLimiter } from '../../middleware/rateLimiters';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const organizerAuthRouter = Router();

organizerAuthRouter.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.organizer.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'Email already registered');

    const passwordHash = await hashPassword(body.password);
    const organizer = await prisma.organizer.create({
      data: { email: body.email, passwordHash, name: body.name },
    });

    const token = signJwt({ id: organizer.id }, env.organizerJwtSecret);
    res.cookie('organizer_token', token, authCookieOptions());
    res.status(201).json({ id: organizer.id, email: organizer.email, name: organizer.name });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

organizerAuthRouter.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const organizer = await prisma.organizer.findUnique({ where: { email: body.email } });
    if (!organizer) throw new AppError(401, 'Invalid email or password');

    const valid = await verifyPassword(body.password, organizer.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid email or password');

    const token = signJwt({ id: organizer.id }, env.organizerJwtSecret);
    res.cookie('organizer_token', token, authCookieOptions());
    res.status(200).json({ id: organizer.id, email: organizer.email, name: organizer.name });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(400, 'Invalid request body'));
    next(err);
  }
});

organizerAuthRouter.post('/logout', (req, res) => {
  // sameSite/secure must match the cookie's original options for clearCookie to
  // actually clear it in all browsers; maxAge is dropped since Express deprecates
  // (and ignores) it here — clearCookie already expires the cookie immediately.
  const { maxAge, ...clearOptions } = authCookieOptions();
  res.clearCookie('organizer_token', clearOptions);
  res.status(200).json({ ok: true });
});
