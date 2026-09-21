import { RequestHandler } from 'express';
import { AppError } from './errorHandler';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Cross-site <form> submissions cannot set custom headers, so requiring one
// forces the browser to issue a CORS preflight for any cross-origin request —
// which the app's origin-locked CORS config then rejects. This closes the CSRF
// gap that SameSite=None (required for the cross-origin frontend/API split in
// production) otherwise leaves open, without needing a token-issuance scheme.
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.header('X-Requested-With') !== 'event-ticketing-frontend') {
    return next(new AppError(403, 'Missing required request header'));
  }
  next();
};
