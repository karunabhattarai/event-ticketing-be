import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';

export async function getOwnedTierOrThrow(eventId: string, tierId: string, organizerId: string) {
  const tier = await prisma.ticketTier.findFirst({
    where: { id: tierId, eventId, event: { organizerId } },
  });
  if (!tier) throw new AppError(404, 'Ticket tier not found');
  return tier;
}
