import { describe, it, expect } from 'vitest';
import { isUniqueConstraintError } from './prismaErrors';

describe('isUniqueConstraintError', () => {
  it('returns true for an object with code P2002', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
  });

  it('returns false for other Prisma error codes', () => {
    expect(isUniqueConstraintError({ code: 'P2025' })).toBe(false);
  });

  it('returns false for a plain Error with no code', () => {
    expect(isUniqueConstraintError(new Error('boom'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
  });
});
