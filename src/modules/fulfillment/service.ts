import QRCode from 'qrcode';
import { sendMail } from '@arbyte-solutions/mail-service';
import { prisma } from '../../db/client';
import { signTicketCode } from '../../lib/ticketCode';
import { env } from '../../env';

export async function fulfillOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { ticketTier: { include: { event: true } }, tickets: true } } },
  });

  // Idempotent ticket minting: only create tickets for OrderItems that don't already have them
  // (covers the resend-ticket-email action calling this a second time).
  for (const item of order.items) {
    if (item.tickets.length > 0) continue;

    for (let i = 0; i < item.quantity; i++) {
      const ticket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'pending' } });
      const code = signTicketCode(ticket.id, item.ticketTier.eventId);
      await prisma.ticket.update({ where: { id: ticket.id }, data: { code } });
    }
  }

  const refreshedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { ticketTier: { include: { event: true } }, tickets: true } }, buyer: true },
  });

  // guestEmail is only populated for guest checkout; a logged-in buyer's
  // order has buyerId set instead, so fall back to the account's email.
  const recipientEmail = refreshedOrder.guestEmail ?? refreshedOrder.buyer?.email;
  if (!recipientEmail) return;

  const attachments = [];
  const ticketLines: string[] = [];
  let cidIndex = 0;
  for (const item of refreshedOrder.items) {
    for (const ticket of item.tickets) {
      const cid = `ticket-${cidIndex++}`;
      const png = await QRCode.toBuffer(ticket.code);
      attachments.push({ filename: `${cid}.png`, content: png, contentType: 'image/png', cid });
      ticketLines.push(`<p>${item.ticketTier.name} — <img src="cid:${cid}" width="120" height="120" /></p>`);
    }
  }

  const html = `
    <h2>${refreshedOrder.items[0]?.ticketTier.event.title ?? 'Your tickets'}</h2>
    <p>Here are your tickets:</p>
    ${ticketLines.join('\n')}
  `;

  try {
    await sendMail(
      {
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        user: env.smtp.user,
        pass: env.smtp.pass,
        from: env.smtp.from,
      },
      { to: recipientEmail, subject: 'Your tickets', html, attachments }
    );
  } catch (err) {
    console.error(`fulfillOrder: email send failed for order ${orderId}`, err);
    return; // order stays 'paid' — tickets are valid, resend can be retried later
  }

  await prisma.order.update({ where: { id: orderId }, data: { status: 'fulfilled', fulfilledAt: new Date() } });
}
