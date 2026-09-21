import QRCode from 'qrcode';
import { sendMail } from '@arbyte-solutions/mail-service';
import { prisma } from '../../db/client';
import { signTicketCode } from '../../lib/ticketCode';
import { env } from '../../env';

export async function fulfillOrder(orderId: string): Promise<void> {
  // Atomic claim on ticket-minting: fulfilledAt now means "tickets have been
  // minted for this order", set here at claim time (not tied to email success
  // or the final status write). Only the caller that flips fulfilledAt from
  // null mints tickets — concurrent callers (buyer resend, organizer resend,
  // expiry sweep's paid-reconciliation branch) all fall through to re-sending
  // the email without re-minting.
  const claim = await prisma.order.updateMany({
    where: { id: orderId, fulfilledAt: null },
    data: { fulfilledAt: new Date() },
  });

  if (claim.count === 1) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { ticketTier: { include: { event: true } }, tickets: true } } },
    });

    for (const item of order.items) {
      if (item.tickets.length > 0) continue; // defensive; claim already prevents this path from racing

      for (let i = 0; i < item.quantity; i++) {
        const ticket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'pending' } });
        const code = signTicketCode(ticket.id, item.ticketTier.eventId);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { code } });
      }
    }
  }
  // claim.count === 0 means tickets are already minted (either by an earlier call to
  // this function, or this order is being fulfilled elsewhere) — fall through to the
  // email send below unconditionally, since resend must always be able to re-send.

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

  // Conditional: only a 'paid' order transitions to 'fulfilled' — never overwrites
  // 'refunded'/'failed'/any other terminal status a concurrent refund may have set.
  await prisma.order.updateMany({
    where: { id: orderId, status: 'paid' },
    data: { status: 'fulfilled' },
  });
}
