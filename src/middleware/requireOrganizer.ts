import { RequestHandler } from 'express';
import { verifyJwt } from '../lib/auth';
import { env } from '../env';
import { AppError } from './errorHandler';

export const requireOrganizer: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.organizer_token;
  if (!token) return next(new AppError(401, 'Not authenticated'));

  const decoded = verifyJwt(token, env.organizerJwtSecret);
  if (!decoded) return next(new AppError(401, 'Not authenticated'));

  req.organizerId = decoded.id;
  next();
};
