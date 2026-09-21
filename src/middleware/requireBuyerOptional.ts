import { RequestHandler } from 'express';
import { verifyJwt } from '../lib/auth';
import { env } from '../env';

export const requireBuyerOptional: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.buyer_token;
  if (token) {
    const decoded = verifyJwt(token, env.buyerJwtSecret);
    if (decoded) req.buyerId = decoded.id;
  }
  next();
};
