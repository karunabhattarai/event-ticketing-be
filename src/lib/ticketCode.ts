import crypto from 'crypto';
import { env } from '../env';

function hmac(ticketId: string, eventId: string): string {
  return crypto
    .createHmac('sha256', env.ticketSecret)
    .update(`${ticketId}.${eventId}`, 'utf8')
    .digest('hex');
}

export function signTicketCode(ticketId: string, eventId: string): string {
  const sig = hmac(ticketId, eventId);
  return `${ticketId}.${eventId}.${sig}`;
}

export function verifyTicketCode(code: string): { ticketId: string; eventId: string } | null {
  const parts = code.split('.');
  if (parts.length !== 3) return null;
  const [ticketId, eventId, sig] = parts;

  const expected = hmac(ticketId, eventId);
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  return { ticketId, eventId };
}
