import { RequestHandler } from 'express';
import { verifyJwt } from '../lib/auth';
import { env } from '../env';

export const requireOrganizerOptional: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.organizer_token;
  if (token) {
    const decoded = verifyJwt(token, env.organizerJwtSecret);
    if (decoded) req.organizerId = decoded.id;
  }
  next();
};
