import { describe, it, expect, vi } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';

vi.mock('./expiry', () => ({ expireStalePendingOrders: vi.fn(async () => ({ checked: 3, expired: 1 })) }));
import { expireStalePendingOrders } from './expiry';

describe('POST /internal/orders/expire', () => {
  it('runs the sweep when the cron secret header matches', async () => {
    await truncateAll();
    const res = await testApp().post('/internal/orders/expire').set('X-Cron-Secret', process.env.CRON_SECRET!);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 3, expired: 1 });
    expect(expireStalePendingOrders).toHaveBeenCalledTimes(1);
  });

  it('403s without the correct secret', async () => {
    const res = await testApp().post('/internal/orders/expire').set('X-Cron-Secret', 'wrong');
    expect(res.status).toBe(403);
  });

  it('403s with no secret header at all', async () => {
    const res = await testApp().post('/internal/orders/expire');
    expect(res.status).toBe(403);
  });
});
