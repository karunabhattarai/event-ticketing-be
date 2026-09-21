import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../db/client';
import { truncateAll } from '../../../tests/helpers/testDb';

vi.mock('@arbyte-solutions/fonepay-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arbyte-solutions/fonepay-service')>();
  return {
    ...actual,
    checkStatus: vi.fn(),
    checkDynamicQrStatus: vi.fn(),
  };
});
vi.mock('@arbyte-solutions/mail-service', () => ({ sendMail: vi.fn(async () => {}) }));

import { checkStatus, checkDynamicQrStatus } from '@arbyte-solutions/fonepay-service';
import { expireStalePendingOrders } from './expiry';

beforeEach(async () => {
  await truncateAll();
  vi.mocked(checkStatus).mockReset();
  vi.mocked(checkDynamicQrStatus).mockReset();
});

async function setupStaleOrder(overrides: Partial<{ paymentMethod: 'redirect' | 'dynamic_qr'; fonepayBankCode: string | null; fonepayUid: string | null; ageMinutes: number }> = {}) {
  const organizer = await prisma.organizer.create({ data: { email: `o-${Math.random()}@example.com`, passwordHash: 'x', name: 'O' } });
  const event = await prisma.event.create({ data: { organizerId: organizer.id, title: 'Show', description: 'd', venue: 'v', startsAt: new Date(), status: 'published' } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'General', price: 800, quantityTotal: 10, quantitySold: 1 } });
  const order = await prisma.order.create({
    data: {
      guestEmail: 'b@example.com',
      guestName: 'B',
      status: 'pending',
      totalAmount: 800,
      paymentMethod: overrides.paymentMethod ?? 'redirect',
      prn: `PRN-EXPIRE-${Math.random()}`,
      fonepayBankCode: overrides.fonepayBankCode ?? null,
      fonepayUid: overrides.fonepayUid ?? null,
      createdAt: new Date(Date.now() - (overrides.ageMinutes ?? 20) * 60 * 1000),
      items: { create: [{ ticketTierId: tier.id, quantity: 1, unitPrice: 800 }] },
    },
  });
  return { order, tier };
}

describe('expireStalePendingOrders', () => {
  it('leaves recent pending orders untouched', async () => {
    const { order } = await setupStaleOrder({ ageMinutes: 2 });
    const result = await expireStalePendingOrders();
    expect(result.expired).toBe(0);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('pending');
  });

  it('expires a stale redirect order with no bankCode/uid to reconcile against, and releases stock', async () => {
    const { order, tier } = await setupStaleOrder({ paymentMethod: 'redirect', fonepayBankCode: null, fonepayUid: null });
    const result = await expireStalePendingOrders();
    expect(result.expired).toBe(1);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('failed');
    const updatedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(updatedTier.quantitySold).toBe(0);
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('reconciles a stale redirect order that has bankCode/uid — marks paid if Fonepay confirms success', async () => {
    const { order } = await setupStaleOrder({ paymentMethod: 'redirect', fonepayBankCode: 'BANK1', fonepayUid: 'uid-1' });
    vi.mocked(checkStatus).mockResolvedValue({
      PRN: order.prn, PID: 'x', PS: 'true', RC: 'successful', UID: 'uid-1', BC: 'BANK1', INI: 'x', P_AMT: '800', R_AMT: '800', DV: 'x',
    });

    const result = await expireStalePendingOrders();
    expect(result.expired).toBe(0);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('fulfilled');
  });

  it('reconciles a stale QR order via checkDynamicQrStatus — expires if Fonepay reports failure', async () => {
    const { order, tier } = await setupStaleOrder({ paymentMethod: 'dynamic_qr' });
    vi.mocked(checkDynamicQrStatus).mockResolvedValue({ paymentStatus: 'failed', fonepayTraceId: '', prn: order.prn, merchantCode: '' });

    const result = await expireStalePendingOrders();
    expect(result.expired).toBe(1);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('failed');
    const updatedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(updatedTier.quantitySold).toBe(0);
  });

  it('reconciles a stale QR order — marks paid if Fonepay reports success', async () => {
    const { order } = await setupStaleOrder({ paymentMethod: 'dynamic_qr' });
    vi.mocked(checkDynamicQrStatus).mockResolvedValue({ paymentStatus: 'success', fonepayTraceId: 'trace-1', prn: order.prn, merchantCode: '' });

    const result = await expireStalePendingOrders();
    expect(result.expired).toBe(0);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('fulfilled');
  });

  it('continues processing other orders when one order throws during reconciliation', async () => {
    const { order: throwingOrder } = await setupStaleOrder({ paymentMethod: 'dynamic_qr' });
    const { order: healthyOrder, tier: healthyTier } = await setupStaleOrder({ paymentMethod: 'redirect', fonepayBankCode: null, fonepayUid: null });

    vi.mocked(checkDynamicQrStatus).mockImplementation(async (_config, { prn }) => {
      if (prn === throwingOrder.prn) throw new Error('Fonepay network error');
      return { paymentStatus: 'failed', fonepayTraceId: '', prn, merchantCode: '' };
    });

    const result = await expireStalePendingOrders();

    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.expired).toBe(1);

    const stillPending = await prisma.order.findUniqueOrThrow({ where: { id: throwingOrder.id } });
    expect(stillPending.status).toBe('pending');

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: healthyOrder.id } });
    expect(settled.status).toBe('failed');
    const updatedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: healthyTier.id } });
    expect(updatedTier.quantitySold).toBe(0);
  });

  it('retries once on a transient checkDynamicQrStatus failure and succeeds on the 2nd call', async () => {
    const { order } = await setupStaleOrder({ paymentMethod: 'dynamic_qr' });
    vi.mocked(checkDynamicQrStatus)
      .mockRejectedValueOnce(new Error('transient network blip'))
      .mockResolvedValueOnce({ paymentStatus: 'success', fonepayTraceId: 'trace-1', prn: order.prn, merchantCode: '' });

    const result = await expireStalePendingOrders();

    expect(checkDynamicQrStatus).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(0);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('fulfilled');
  });

  it('propagates as a failure after two consecutive checkDynamicQrStatus failures (retries exactly once)', async () => {
    const { order } = await setupStaleOrder({ paymentMethod: 'dynamic_qr' });
    vi.mocked(checkDynamicQrStatus).mockRejectedValue(new Error('still down'));

    const result = await expireStalePendingOrders();

    expect(checkDynamicQrStatus).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(1);
    const stillPending = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillPending.status).toBe('pending');
  });
});
