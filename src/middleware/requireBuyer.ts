import { RequestHandler } from 'express';
import { verifyJwt } from '../lib/auth';
import { env } from '../env';
import { AppError } from './errorHandler';

export const requireBuyer: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.buyer_token;
  if (!token) return next(new AppError(401, 'Not authenticated'));

  const decoded = verifyJwt(token, env.buyerJwtSecret);
  if (!decoded) return next(new AppError(401, 'Not authenticated'));

  req.buyerId = decoded.id;
  next();
};
