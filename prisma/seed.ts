// Manual QA seed data. Run with `npm run db:seed`.
// Creates one organizer, one buyer, a set of events/tiers covering edge cases,
// and orders in every status so the frontend can be clicked through end to end
// without needing a working payment gateway.
import { PrismaClient, EventStatus, OrderStatus, PaymentMethod, TicketStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

const ORGANIZER_EMAIL = 'organizer@test.local';
const ORGANIZER_PASSWORD = 'password123';
const OTHER_ORGANIZER_EMAIL = 'other-organizer@test.local';
const BUYER_EMAIL = 'buyer@test.local';
const BUYER_PASSWORD = 'password123';
// Must match the API's TICKET_SECRET or seeded ticket codes will fail check-in
// verification, so fail loudly rather than fall back to a guess.
function requireTicketSecret(): string {
  const secret = process.env.TICKET_SECRET;
  if (!secret) throw new Error('TICKET_SECRET is required (run via `yarn db:seed` so .env is loaded)');
  return secret;
}
const TICKET_SECRET = requireTicketSecret();

function signTicketCode(ticketId: string, eventId: string): string {
  const sig = crypto.createHmac('sha256', TICKET_SECRET).update(`${ticketId}.${eventId}`, 'utf8').digest('hex');
  return `${ticketId}.${eventId}.${sig}`;
}

function prn(): string {
  return `SEED${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

// Remove everything a previous seed run created so re-running gives a clean,
// identical dataset instead of duplicating events/orders. Scoped to the seed
// accounts, so it never touches other organizers' or buyers' data.
async function resetSeedData() {
  const organizers = await prisma.organizer.findMany({
    where: { email: { in: [ORGANIZER_EMAIL, OTHER_ORGANIZER_EMAIL] } },
    select: { id: true },
  });
  const buyer = await prisma.buyer.findUnique({ where: { email: BUYER_EMAIL }, select: { id: true } });
  const organizerIds = organizers.map((o) => o.id);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { items: { some: { ticketTier: { event: { organizerId: { in: organizerIds } } } } } },
        ...(buyer ? [{ buyerId: buyer.id }] : []),
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  await prisma.ticket.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.ticketTier.deleteMany({ where: { event: { organizerId: { in: organizerIds } } } });
  await prisma.event.deleteMany({ where: { organizerId: { in: organizerIds } } });
}

async function main() {
  console.log('Seeding...');
  await resetSeedData();

  const passwordHash = await bcrypt.hash(ORGANIZER_PASSWORD, 10);
  const organizer = await prisma.organizer.upsert({
    where: { email: ORGANIZER_EMAIL },
    update: {},
    create: { email: ORGANIZER_EMAIL, passwordHash, name: 'Test Organizer' },
  });

  const buyerPasswordHash = await bcrypt.hash(BUYER_PASSWORD, 10);
  const buyer = await prisma.buyer.upsert({
    where: { email: BUYER_EMAIL },
    update: {},
    create: { email: BUYER_EMAIL, passwordHash: buyerPasswordHash, name: 'Test Buyer' },
  });

  // A second organizer, used only to prove cross-organizer isolation
  // (org A must never see org B's events/orders).
  const otherOrganizer = await prisma.organizer.upsert({
    where: { email: OTHER_ORGANIZER_EMAIL },
    update: {},
    create: { email: OTHER_ORGANIZER_EMAIL, passwordHash, name: 'Other Organizer' },
  });

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // --- Event 1: normal published event, on sale now, plenty of stock ---
  const liveEvent = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Kathmandu Music Night',
      description: 'A live music showcase in Kathmandu.',
      venue: 'Bhrikutimandap Exhibition Hall',
      startsAt: new Date(now + 14 * day),
      status: EventStatus.published,
    },
  });
  const generalTier = await prisma.ticketTier.create({
    data: { eventId: liveEvent.id, name: 'General', price: 800, quantityTotal: 100, quantitySold: 12 },
  });
  const vipTier = await prisma.ticketTier.create({
    data: { eventId: liveEvent.id, name: 'VIP', price: 2500, quantityTotal: 20, quantitySold: 3 },
  });
  // Almost sold out — good for testing the "few left" / disabled-at-zero path.
  const almostSoldOutTier = await prisma.ticketTier.create({
    data: { eventId: liveEvent.id, name: 'Front Row (2 left)', price: 5000, quantityTotal: 10, quantitySold: 8 },
  });
  // Fully sold out — must not be purchasable.
  const soldOutTier = await prisma.ticketTier.create({
    data: { eventId: liveEvent.id, name: 'Backstage Pass (SOLD OUT)', price: 10000, quantityTotal: 5, quantitySold: 5 },
  });
  // Sales window not open yet — must be visible but not purchasable / hidden per UI spec.
  const notYetOnSaleTier = await prisma.ticketTier.create({
    data: {
      eventId: liveEvent.id,
      name: 'Early Bird (not on sale yet)',
      price: 600,
      quantityTotal: 50,
      salesStartAt: new Date(now + 7 * day),
    },
  });
  // Sales window already ended — must not be purchasable.
  const salesEndedTier = await prisma.ticketTier.create({
    data: {
      eventId: liveEvent.id,
      name: 'Last Call (sales ended)',
      price: 700,
      quantityTotal: 50,
      salesEndAt: new Date(now - 1 * day),
    },
  });

  // --- Event 2: published, starts very soon (tests "event passed/soon" UI) ---
  const soonEvent = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Pokhara Sunrise Trek Meetup',
      description: 'Meetup before a sunrise trek.',
      venue: 'Sarangkot Viewpoint',
      startsAt: new Date(now + 6 * 60 * 60 * 1000), // 6h from now
      status: EventStatus.published,
    },
  });
  await prisma.ticketTier.create({
    data: { eventId: soonEvent.id, name: 'Entry', price: 300, quantityTotal: 30, quantitySold: 0 },
  });

  // --- Event 3: past event (starts in the past) — should not be purchasable, tests listing filters ---
  const pastEvent = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Old Expired Concert',
      description: 'This already happened.',
      venue: 'Old Venue',
      startsAt: new Date(now - 10 * day),
      status: EventStatus.published,
    },
  });
  await prisma.ticketTier.create({
    data: { eventId: pastEvent.id, name: 'General', price: 500, quantityTotal: 100, quantitySold: 40 },
  });

  // --- Event 4: draft — must not appear in public listing/detail ---
  const draftEvent = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Unannounced Festival (DRAFT)',
      description: 'Still being put together.',
      venue: 'TBD',
      startsAt: new Date(now + 30 * day),
      status: EventStatus.draft,
    },
  });
  await prisma.ticketTier.create({
    data: { eventId: draftEvent.id, name: 'General', price: 1000, quantityTotal: 50 },
  });

  // --- Event 5: cancelled — must show as cancelled, block checkout/check-in ---
  const cancelledEvent = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Cancelled Comedy Show',
      description: 'This got cancelled.',
      venue: 'Someplace',
      startsAt: new Date(now + 5 * day),
      status: EventStatus.cancelled,
    },
  });
  const cancelledEventTier = await prisma.ticketTier.create({
    data: { eventId: cancelledEvent.id, name: 'General', price: 400, quantityTotal: 50, quantitySold: 5 },
  });

  // --- Event 6: belongs to the OTHER organizer — used to test isolation ---
  const otherOrgEvent = await prisma.event.create({
    data: {
      organizerId: otherOrganizer.id,
      title: "Other Organizer's Event",
      description: 'Should not be visible/editable by the main test organizer.',
      venue: 'Elsewhere',
      startsAt: new Date(now + 20 * day),
      status: EventStatus.published,
    },
  });
  await prisma.ticketTier.create({
    data: { eventId: otherOrgEvent.id, name: 'General', price: 900, quantityTotal: 30 },
  });

  // Long title/description to test text overflow/wrapping in cards and detail page.
  await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'A Very Long Event Title That Should Test How The UI Wraps Or Truncates Extremely Long Headlines In Cards And Page Headers',
      description:
        'A very long description. '.repeat(40) +
        ' Includes special characters: <script>alert(1)</script> & "quotes" \'apostrophes\' — to test HTML escaping.',
      venue: 'Somewhere with a really long venue name that also might overflow the layout',
      startsAt: new Date(now + 15 * day),
      status: EventStatus.published,
    },
  }).then(async (longEvent) => {
    await prisma.ticketTier.create({
      data: { eventId: longEvent.id, name: 'General', price: 1, quantityTotal: 5 },
    });
  });

  // ---------- Orders in every status ----------

  async function makeOrder(opts: {
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    tierId: string;
    unitPrice: number;
    quantity: number;
    buyerId?: string;
    guestEmail?: string;
    guestName?: string;
    paidAt?: Date;
    fulfilledAt?: Date;
    withTickets?: boolean;
    ticketStatus?: TicketStatus;
  }) {
    const totalAmount = opts.unitPrice * opts.quantity;
    const order = await prisma.order.create({
      data: {
        buyerId: opts.buyerId,
        guestEmail: opts.buyerId ? undefined : opts.guestEmail ?? 'guest@test.local',
        guestName: opts.buyerId ? undefined : opts.guestName ?? 'Guest Buyer',
        status: opts.status,
        totalAmount,
        paymentMethod: opts.paymentMethod,
        prn: prn(),
        paidAt: opts.paidAt,
        fulfilledAt: opts.fulfilledAt,
        items: {
          create: [{ ticketTierId: opts.tierId, quantity: opts.quantity, unitPrice: opts.unitPrice }],
        },
      },
      include: { items: true },
    });

    if (opts.withTickets) {
      const item = order.items[0];
      const tierEvent = await prisma.ticketTier.findUniqueOrThrow({ where: { id: opts.tierId } });
      for (let i = 0; i < opts.quantity; i++) {
        const ticketId = crypto.randomUUID();
        await prisma.ticket.create({
          data: {
            id: ticketId,
            orderItemId: item.id,
            code: signTicketCode(ticketId, tierEvent.eventId),
            status: opts.ticketStatus ?? TicketStatus.valid,
            checkedInAt: opts.ticketStatus === TicketStatus.used ? new Date() : undefined,
            checkedInBy: opts.ticketStatus === TicketStatus.used ? organizer.id : undefined,
          },
        });
      }
    }
    return order;
  }

  // Pending redirect order — use its accessToken to hit /orders/:id?token=... and the
  // redirect payment page without ever calling Fonepay.
  const pendingRedirectOrder = await makeOrder({
    status: OrderStatus.pending,
    paymentMethod: PaymentMethod.redirect,
    tierId: generalTier.id,
    unitPrice: 800,
    quantity: 2,
    guestEmail: 'pending-redirect@test.local',
    guestName: 'Pending Redirect Guest',
  });

  // Pending dynamic-QR order — same idea for the QR payment page.
  const pendingQrOrder = await makeOrder({
    status: OrderStatus.pending,
    paymentMethod: PaymentMethod.dynamic_qr,
    tierId: vipTier.id,
    unitPrice: 2500,
    quantity: 1,
    guestEmail: 'pending-qr@test.local',
    guestName: 'Pending QR Guest',
  });

  // Paid but not yet fulfilled (simulates fulfillment having failed/not run) —
  // tests the resend/fulfillment-retry path.
  const paidUnfulfilledOrder = await makeOrder({
    status: OrderStatus.paid,
    paymentMethod: PaymentMethod.redirect,
    tierId: generalTier.id,
    unitPrice: 800,
    quantity: 1,
    paidAt: new Date(now - 5 * 60 * 1000),
    guestEmail: 'paid-unfulfilled@test.local',
    guestName: 'Paid Unfulfilled Guest',
  });

  // Fully fulfilled order tied to the seeded buyer — appears in "My Orders", has
  // real scannable ticket codes for the check-in page.
  const fulfilledOrder = await makeOrder({
    status: OrderStatus.paid,
    paymentMethod: PaymentMethod.redirect,
    tierId: generalTier.id,
    unitPrice: 800,
    quantity: 2,
    buyerId: buyer.id,
    paidAt: new Date(now - day),
    fulfilledAt: new Date(now - day + 60000),
    withTickets: true,
  });

  // Fulfilled order with one ticket already checked in — tests check-in's
  // "already used" (409) path, and the buyer-facing per-ticket status.
  const partiallyUsedOrder = await makeOrder({
    status: OrderStatus.paid,
    paymentMethod: PaymentMethod.dynamic_qr,
    tierId: vipTier.id,
    unitPrice: 2500,
    quantity: 1,
    buyerId: buyer.id,
    paidAt: new Date(now - 2 * day),
    fulfilledAt: new Date(now - 2 * day + 60000),
    withTickets: true,
    ticketStatus: TicketStatus.used,
  });

  // Failed order (e.g. payment declined / expired) — tests order-status page's
  // failed state and that stock was NOT held against it.
  const failedOrder = await makeOrder({
    status: OrderStatus.failed,
    paymentMethod: PaymentMethod.redirect,
    tierId: generalTier.id,
    unitPrice: 800,
    quantity: 1,
    guestEmail: 'failed@test.local',
    guestName: 'Failed Guest',
  });

  // Refunded order with void tickets — tests organizer refund history + check-in
  // rejecting a refunded order's ticket.
  const refundedOrder = await makeOrder({
    status: OrderStatus.refunded,
    paymentMethod: PaymentMethod.redirect,
    tierId: cancelledEventTier.id,
    unitPrice: 400,
    quantity: 1,
    paidAt: new Date(now - 3 * day),
    fulfilledAt: new Date(now - 3 * day + 60000),
    withTickets: true,
    ticketStatus: TicketStatus.void,
    guestEmail: 'refunded@test.local',
    guestName: 'Refunded Guest',
  });

  console.log('\nSeed complete.\n');
  console.log('Organizer login:', ORGANIZER_EMAIL, '/', ORGANIZER_PASSWORD);
  console.log('Other organizer login:', OTHER_ORGANIZER_EMAIL, '/', ORGANIZER_PASSWORD, '(for isolation checks)');
  console.log('Buyer login:', BUYER_EMAIL, '/', BUYER_PASSWORD);
  console.log('\nEvents:');
  console.log('  Live event id:', liveEvent.id, '- tiers: general/vip/almost-sold-out/sold-out/not-yet-on-sale/sales-ended');
  console.log('  Soon event id:', soonEvent.id);
  console.log('  Past event id:', pastEvent.id);
  console.log('  Draft event id:', draftEvent.id, '(should be invisible publicly)');
  console.log('  Cancelled event id:', cancelledEvent.id);
  console.log('  Other-organizer event id:', otherOrgEvent.id);
  console.log('\nOrders (id / accessToken) for hitting order-status & payment pages directly:');
  for (const [label, o] of [
    ['pending redirect', pendingRedirectOrder],
    ['pending dynamic_qr', pendingQrOrder],
    ['paid, unfulfilled', paidUnfulfilledOrder],
    ['fulfilled (buyer)', fulfilledOrder],
    ['fulfilled, 1 ticket used', partiallyUsedOrder],
    ['failed', failedOrder],
    ['refunded', refundedOrder],
  ] as const) {
    console.log(`  ${label}: /order/${o.id}/status?token=${o.accessToken}`);
  }

  const fulfilledTickets = await prisma.ticket.findMany({
    where: { orderItem: { orderId: fulfilledOrder.id } },
  });
  console.log('\nScannable ticket codes (paste into check-in page):');
  for (const t of fulfilledTickets) console.log('  valid:', t.code);
  const usedTicket = await prisma.ticket.findFirst({ where: { orderItem: { orderId: partiallyUsedOrder.id } } });
  if (usedTicket) console.log('  already-used:', usedTicket.code);
  const voidTicket = await prisma.ticket.findFirst({ where: { orderItem: { orderId: refundedOrder.id } } });
  if (voidTicket) console.log('  void (refunded):', voidTicket.code);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
