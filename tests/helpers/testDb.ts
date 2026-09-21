import { prisma } from '../../src/db/client';

export async function truncateAll(): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.ticketTier.deleteMany(),
    prisma.event.deleteMany(),
    prisma.buyer.deleteMany(),
    prisma.organizer.deleteMany(),
  ]);
}
