import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from './client';
import { truncateAll } from '../../tests/helpers/testDb';

beforeEach(async () => {
  await truncateAll();
});

describe('prisma client', () => {
  it('can create and read an Organizer', async () => {
    const org = await prisma.organizer.create({
      data: { email: 'a@example.com', passwordHash: 'x', name: 'Test Org' },
    });
    const found = await prisma.organizer.findUnique({ where: { id: org.id } });
    expect(found?.email).toBe('a@example.com');
  });
});
