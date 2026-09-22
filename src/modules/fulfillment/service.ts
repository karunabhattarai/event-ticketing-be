import crypto from 'crypto';
import QRCode from 'qrcode';
import { sendMail } from '@arbyte-solutions/mail-service';
import { prisma } from '../../db/client';
import { signTicketCode } from '../../lib/ticketCode';
import { env } from '../../env';

// Organizer-controlled strings (tier name, event title) end up interpolated into the
// ticket confirmation HTML email below — escape them so an organizer can't inject
// markup/links into every buyer's inbox via a tier or event name.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function fulfillOrder(orderId: string): Promise<{ emailSent: boolean }> {
  // Claim + mint run in one transaction: if minting throws for any reason
  // (e.g. a transient DB error), the whole transaction rolls back, including
  // the fulfilledAt claim — so the order is left exactly as it was and the
  // next caller (resend, sweep) can safely retry the mint from scratch.
  // Ticket ids are generated client-side so the signed code can be computed
  // and inserted in a single createMany — no placeholder code, no window
  // where two tickets could collide on the unique `code` column.
  await prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: orderId, fulfilledAt: null },
      data: { fulfilledAt: new Date() },
    });
    if (claim.count === 0) return; // already minted by an earlier call — email-only path below handles resend

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { ticketTier: true, tickets: true } } },
    });

    const rows: { id: string; orderItemId: string; code: string }[] = [];
    for (const item of order.items) {
      if (item.tickets.length > 0) continue; // defensive; the claim already prevents this from racing
      for (let i = 0; i < item.quantity; i++) {
        const id = crypto.randomUUID();
        rows.push({ id, orderItemId: item.id, code: signTicketCode(id, item.ticketTier.eventId) });
      }
    }
    if (rows.length > 0) {
      await tx.ticket.createMany({ data: rows });
    }
  });

  const refreshedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { ticketTier: { include: { event: true } }, tickets: true } }, buyer: true },
  });

  // guestEmail is only populated for guest checkout; a logged-in buyer's
  // order has buyerId set instead, so fall back to the account's email.
  const recipientEmail = refreshedOrder.guestEmail ?? refreshedOrder.buyer?.email;
  if (!recipientEmail) return { emailSent: false };

  const attachments = [];
  const ticketLines: string[] = [];
  let cidIndex = 0;
  for (const item of refreshedOrder.items) {
    for (const ticket of item.tickets) {
      const cid = `ticket-${cidIndex++}`;
      const png = await QRCode.toBuffer(ticket.code);
      attachments.push({ filename: `${cid}.png`, content: png, contentType: 'image/png', cid });
      ticketLines.push(`<p>${escapeHtml(item.ticketTier.name)} — <img src="cid:${cid}" width="120" height="120" /></p>`);
    }
  }

  const eventTitle = refreshedOrder.items[0]?.ticketTier.event.title;
  const html = `
    <h2>${eventTitle ? escapeHtml(eventTitle) : 'Your tickets'}</h2>
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
    return { emailSent: false }; // order stays 'paid' — tickets are valid, resend can be retried later
  }

  // Conditional: only a 'paid' order transitions to 'fulfilled' — never overwrites
  // 'refunded'/'failed'/any other terminal status a concurrent refund may have set.
  await prisma.order.updateMany({
    where: { id: orderId, status: 'paid' },
    data: { status: 'fulfilled' },
  });
  return { emailSent: true };
}
