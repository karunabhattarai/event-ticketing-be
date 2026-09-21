import { describe, it, expect, beforeEach } from 'vitest';
import { testApp } from '../../../tests/helpers/testApp';
import { truncateAll } from '../../../tests/helpers/testDb';
import { prisma } from '../../db/client';

beforeEach(async () => {
  await truncateAll();
});

describe('GET /buyer/orders', () => {
  it("lists the authenticated buyer's own orders", async () => {
    const registerRes = await testApp().post('/buyer/auth/register').send({ email: 'b@example.com', password: 'password123', name: 'B' });
    const cookie = registerRes.headers['set-cookie'];
    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { email: 'b@example.com' } });

    await prisma.order.create({
      data: { buyerId: buyer.id, status: 'fulfilled', totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-MINE-1' },
    });
    await prisma.order.create({
      data: { guestEmail: 'someone-else@example.com', status: 'fulfilled', totalAmount: 800, paymentMethod: 'redirect', prn: 'PRN-OTHER-1' },
    });

    const res = await testApp().get('/buyer/orders').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].prn).toBe('PRN-MINE-1');
  });

  it('401s when not logged in', async () => {
    const res = await testApp().get('/buyer/orders');
    expect(res.status).toBe(401);
  });
});
