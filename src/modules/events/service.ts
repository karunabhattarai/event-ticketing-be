import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';

export async function getOwnedEventOrThrow(eventId: string, organizerId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizerId } });
  if (!event) throw new AppError(404, 'Event not found');
  return event;
}
