import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, deliveryZones, inventory, inventoryMovements, notificationOutbox, productVariants, products } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { FakeProvider } from '../../../testing/fake-provider.js';

type Json = Record<string, any>;

describe('admin orders, fulfilment and bank-transfer confirmation', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let fulfilment: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let variantId = '';
  let n = 0;
  let phones = 0;

  const call = async (method: string, url: string, payload?: Json, who = owner) => {
    const res = await api.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const place = async (paymentMethod: 'card' | 'bank_transfer', deliveryMethod = 'next_day', email?: string) => {
    const phone = `+23484${String(50_000_000 + ++phones)}`;
    const res = await api.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: {
        items: [{ variantId, quantity: 2 }],
        promotionCodes: [],
        contact: { phone, ...(email ? { email } : {}) },
        deliveryAddress: { recipientName: 'Ada Buyer', addressLine1: '1 Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' },
        deliveryMethod,
        paymentMethod,
        termsAccepted: true,
      },
      headers: { 'idempotency-key': `admin-orders-key-${++n}-abcdefgh-0123456789abcdefghijklmnopqrstuv` },
    });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return { ...(res.result as Json), phone } as Json;
  };
  const payByProvider = async (reference: string) => {
    provider.set(reference, { status: 'success' });
    assert.equal((await api.inject({ method: 'POST', url: '/api/v1/checkout/paystack/verify', payload: { reference } })).statusCode, 200);
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    fulfilment = await signInAdmin(t.db, api, 'fulfilment');
    support = await signInAdmin(t.db, api, 'support');
    const [p] = await t.db.insert(products).values({ slug: 'ord-wig', title: 'Order Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'ORD-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 100 });
    variantId = v!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000, pickupEnabled: true });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('lists and filters orders, and exposes detail without guest token material', async () => {
    const a = await place('card');
    const b = await place('bank_transfer');
    const list = await call('GET', '/admin/orders');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length >= 2);
    assert.equal((await call('GET', `/admin/orders?q=${a.orderNumber}`)).body.data.map((o: Json) => o.id).join(), a.orderId);
    assert.equal((await call('GET', `/admin/orders?q=${b.phone.slice(-8)}`)).body.data.length, 1);
    assert.equal((await call('GET', '/admin/orders?status=pending_payment&limit=1')).body.data.length, 1);
    assert.equal((await call('GET', '/admin/orders?status=packed')).body.data.length, 0);
    const detail = await call('GET', `/admin/orders/${a.orderId}`);
    assert.equal(detail.body.order.orderNumber, a.orderNumber);
    assert.equal(detail.body.items[0].quantity, 2);
    assert.equal(detail.body.payments[0].method, 'card');
    assert.equal(JSON.stringify(detail.body).includes('guestCheckoutToken'), false);
    assert.deepEqual(detail.body.allowedTransitions, [], 'nothing to fulfil until paid');
    assert.equal((await call('GET', '/admin/orders/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await call('GET', '/admin/orders', undefined, support)).status, 200, 'support can read orders');
  });

  it('counts orders per status under the other filters, takes several statuses, filters by payment method and shows the area', async () => {
    const card = await place('card');
    const transfer = await place('bank_transfer');
    const list = await call('GET', '/admin/orders?limit=1');
    assert.ok(list.body.counts.pending_payment >= 2, 'counts come with the first page');
    const later = await call('GET', `/admin/orders?limit=1&cursor=${list.body.page.nextCursor}`);
    assert.equal(later.body.counts, null, 'and only with the first page');
    const several = await call('GET', '/admin/orders?status=pending_payment,placed,packed');
    assert.ok(several.body.data.every((o: Json) => ['pending_payment', 'placed', 'packed'].includes(o.status)));
    assert.equal((await call('GET', '/admin/orders?status=pending_payment,nonsense')).status, 422);
    const byMethod = await call('GET', '/admin/orders?method=bank_transfer');
    assert.ok(byMethod.body.data.some((o: Json) => o.id === transfer.orderId));
    assert.ok(!byMethod.body.data.some((o: Json) => o.id === card.orderId));
    // The counts follow the other filters: searching for one order leaves one in its status.
    const narrowed = await call('GET', `/admin/orders?q=${card.orderNumber}`);
    assert.deepEqual(narrowed.body.counts, { pending_payment: 1 });
    assert.equal(narrowed.body.data[0].area, 'Lagos', 'the delivery column names the area (or the city)');
    assert.equal(narrowed.body.data[0].state, 'Lagos');
  });

  it('gives the order screen what it shows: item photos as null without media, and the customer\'s order history', async () => {
    const o = await place('card');
    const detail = await call('GET', `/admin/orders/${o.orderId}`);
    assert.equal(detail.body.items[0].image, null);
    assert.deepEqual([detail.body.customer.paidOrders, detail.body.customer.lifetimeValueMinor], [0, 0], 'nothing paid yet, so no history');
    assert.equal(detail.body.customer.phone, o.phone, 'a guest is still shown by phone');
  });

  it('walks a paid order through fulfilment, notifying the customer at each step', async () => {
    const o = await place('card', 'next_day', 'ada@example.com');
    const early = await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'packed' }, fulfilment);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'ORDER_NOT_PAID');
    await payByProvider(o.reference);

    assert.equal((await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'delivered' }, fulfilment)).status, 409, 'cannot skip steps');
    assert.equal((await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'packed' }, support)).status, 403);

    const packed = await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'packed', note: 'Boxed by Tobi' }, fulfilment);
    assert.equal(packed.status, 200, JSON.stringify(packed.body));
    assert.deepEqual(packed.body.allowedTransitions, ['out_for_delivery']);
    assert.equal((await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'packed' }, fulfilment)).status, 409, 'repeating a step is refused');
    await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'out_for_delivery' }, fulfilment);
    const delivered = await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'delivered' }, fulfilment);
    assert.equal(delivered.body.order.status, 'delivered');
    assert.deepEqual(delivered.body.allowedTransitions, []);
    assert.ok(delivered.body.delivery.deliveredAt);

    const statuses = delivered.body.timeline.map((e: Json) => e.toStatus);
    assert.deepEqual(statuses, ['pending_payment', 'placed', 'packed', 'out_for_delivery', 'delivered']);
    assert.equal(delivered.body.timeline.find((e: Json) => e.toStatus === 'packed').note, 'Boxed by Tobi');

    const sent = (await t.db.select().from(notificationOutbox)).filter((m) => (m.payload as Json).orderId === o.orderId && m.eventType !== 'order.placed');
    assert.deepEqual(sent.map((m) => `${m.eventType}:${m.channel}`).sort(), ['order.delivered:email', 'order.delivered:sms', 'order.out_for_delivery:email', 'order.out_for_delivery:sms', 'order.packed:email', 'order.packed:sms']);

    // The customer's own tracking sees the new statuses.
    const track = await api.inject({ method: 'POST', url: '/api/v1/orders/track', payload: { orderNumber: o.orderNumber, phone: o.phone } });
    assert.equal((track.result as Json).status, 'delivered');
    const actions = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, o.orderId))).map((a) => a.action);
    assert.equal(actions.filter((a) => a === 'order.status').length, 3);
  });

  it('skips dispatch for pickup orders', async () => {
    const o = await place('card', 'pickup');
    await payByProvider(o.reference);
    await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'packed' });
    assert.equal((await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'out_for_delivery' })).status, 409);
    const done = await call('PATCH', `/admin/orders/${o.orderId}/status`, { status: 'delivered' });
    assert.equal(done.status, 200);
  });

  it('records internal notes that never reach the customer timeline', async () => {
    const o = await place('card');
    assert.equal((await call('POST', `/admin/orders/${o.orderId}/notes`, { note: 'Customer asked to call first' }, support)).status, 204);
    const detail = await call('GET', `/admin/orders/${o.orderId}`);
    assert.deepEqual(detail.body.notes.map((x: Json) => x.note), ['Customer asked to call first']);
    const track = await api.inject({ method: 'POST', url: '/api/v1/orders/track', payload: { orderNumber: o.orderNumber, phone: o.phone } });
    assert.ok(!JSON.stringify(track.result).includes('call first'));
  });

  describe('confirm-transfer', () => {
    it('settles through the provider when it has the money, and is idempotent', async () => {
      const o = await place('bank_transfer');
      provider.set(o.reference, { status: 'success' });
      const res = await call('POST', `/admin/orders/${o.orderId}/confirm-transfer`, {});
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.outcome, res.body.mode, res.body.status, res.body.paymentStatus], ['paid', 'provider', 'placed', 'paid']);
      const again = await call('POST', `/admin/orders/${o.orderId}/confirm-transfer`, {});
      assert.deepEqual([again.body.outcome, again.body.mode], ['already_paid', 'none']);
      const sale = await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, o.orderId));
      assert.equal(sale.length, 1, 'stock is consumed exactly once');
    });

    it('refuses without evidence, then settles manually with a recorded reason', async () => {
      const o = await place('bank_transfer');
      const refused = await call('POST', `/admin/orders/${o.orderId}/confirm-transfer`, {});
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error.code, 'TRANSFER_NOT_CONFIRMED');
      assert.equal((await call('POST', `/admin/orders/${o.orderId}/confirm-transfer`, { manualReason: 'short' })).status, 422);
      assert.equal((await call('POST', `/admin/orders/${o.orderId}/confirm-transfer`, { manualReason: 'Bank statement shows credit' }, fulfilment)).status, 403, 'only order writers can confirm');

      const manual = await call('POST', `/admin/orders/${o.orderId}/confirm-transfer`, { manualReason: 'GTBank statement shows N2,000 credit ref 4471' });
      assert.equal(manual.status, 200, JSON.stringify(manual.body));
      assert.deepEqual([manual.body.outcome, manual.body.mode, manual.body.paymentStatus], ['paid', 'manual', 'paid']);
      const [entry] = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, o.orderId))).filter((a) => a.action === 'order.confirm_transfer');
      assert.match(JSON.stringify(entry!.afterJson), /GTBank statement/);
    });

    it('only applies to unpaid transfer orders', async () => {
      const card = await place('card');
      assert.equal((await call('POST', `/admin/orders/${card.orderId}/confirm-transfer`, { manualReason: 'not a transfer order really' })).body.error.code, 'NOT_A_TRANSFER_ORDER');
    });

    it('falls back to a manual reason when the provider is down, and flags a reservation that already expired', async () => {
      const a = await place('bank_transfer');
      provider.verifyDown = true;
      assert.equal((await call('POST', `/admin/orders/${a.orderId}/confirm-transfer`, {})).status, 503);
      const manual = await call('POST', `/admin/orders/${a.orderId}/confirm-transfer`, { manualReason: 'Provider down; statement checked' });
      assert.equal(manual.body.outcome, 'paid');
      provider.reset();

      const b = await place('bank_transfer');
      await t.db.execute(`update stock_reservations set released_at = now() where order_id = '${b.orderId}'` as never);
      const late = await call('POST', `/admin/orders/${b.orderId}/confirm-transfer`, { manualReason: 'Customer paid after the hold ended' });
      assert.equal(late.body.outcome, 'late_payment');
      assert.equal(late.body.status, 'payment_exception');
    });
  });
});
