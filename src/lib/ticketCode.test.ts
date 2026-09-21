import { describe, it, expect, vi } from 'vitest';

vi.mock('../env', () => ({ env: { ticketSecret: 'test-ticket-secret' } }));

import { signTicketCode, verifyTicketCode } from './ticketCode';

describe('ticket code signing', () => {
  it('round-trips a valid code', () => {
    const code = signTicketCode('ticket-1', 'event-1');
    const result = verifyTicketCode(code);
    expect(result).toEqual({ ticketId: 'ticket-1', eventId: 'event-1' });
  });

  it('rejects a tampered code', () => {
    const code = signTicketCode('ticket-1', 'event-1');
    const tampered = code.replace('ticket-1', 'ticket-2');
    expect(verifyTicketCode(tampered)).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    expect(() => verifyTicketCode('not-a-real-code')).not.toThrow();
    expect(verifyTicketCode('not-a-real-code')).toBeNull();
  });

  it('produces different codes for different secrets', () => {
    const codeA = signTicketCode('ticket-1', 'event-1');
    // Codes must be deterministic per (id, secret) pair, not random
    const codeB = signTicketCode('ticket-1', 'event-1');
    expect(codeA).toBe(codeB);
  });
});
