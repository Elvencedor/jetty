import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, deliveries, deliveryZones, inventory, inventoryMovements, notificationOutbox, orders, orderStatusEvents, paymentAttempts, stockReservations } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { adminTestEnv, signInAdmin } from '../../testing/admin.js';
import { makeProduct, paidOrder } from '../../testing/catalog-fixtures.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeProvider } from '../../testing/fake-provider.js';
import { FakeStorage } from '../../testing/fake-storage.js';

type Json = Record<string, any>;
const KEY = (tag: string) => `${tag}-0123456789abcdefghijklmnopqrstuvwxyz`;
const lagosDate = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d);
};

describe('order and quote contract for the storefront', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let fulfilment: Awaited<ReturnType<typeof signInAdmin>>;
  let manager: Awaited<ReturnType<typeof signInAdmin>>;
  let product: Awaited<ReturnType<typeof makeProduct>>;
  let variant = '';
  let n = 0;
  let phones = 0;

  const phone = () => `+23487${String(80_000_000 + ++phones)}`;
  const place = async (over: Json = {}, headers: Record<string, string> = {}) => {
    const res = await api.inject({
      method: 'POST', url: '/api/v1/checkout',
      payload: { items: [{ variantId: variant, quantity: 2 }], promotionCodes: [], contact: { phone: phone() }, deliveryAddress: { recipientName: 'Ada Obi', addressLine1: '1 St', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod: 'card', termsAccepted: true, ...over },
      headers: { 'idempotency-key': KEY(`oc-${++n}`), ...headers },
    });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return { res, body: res.result as Json };
  };
  const pay = async (reference: string) => {
    provider.set(reference, { status: 'success' });
    assert.equal((await api.inject({ method: 'POST', url: '/api/v1/checkout/paystack/verify', payload: { reference } })).statusCode, 200);
  };
  const admin = (method: string, url: string, payload?: Json, who = owner) =>
    api.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: who.headers }).then((r) => ({ status: r.statusCode, body: r.result as Json }));
  const stock = async () => (await t.db.select().from(inventory).where(eq(inventory.variantId, variant)))[0]!;

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider, storage: new FakeStorage() });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    fulfilment = await signInAdmin(t.db, api, 'fulfilment');
    manager = await signInAdmin(t.db, api, 'manager');
    product = await makeProduct(t, 'oc-wig', {
      title: 'Contract Wig', cover: true,
      options: [{ name: 'Length', values: [{ key: '14', label: '14"' }] }, { name: 'Colour', values: [{ key: 'black', label: 'Jet black', swatch: '#111111' }] }],
      variants: [{ sku: 'OC-1', pick: { Length: '14', Colour: 'black' }, price: 100000, compareAt: 125000, stock: 50 }],
    });
    variant = product.variantIds['OC-1']!;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000, pickupEnabled: true });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('quote lines (A1)', () => {
    it('describe themselves: name, link, photo, chosen options, was-price and stock', async () => {
      const res = await api.inject({ method: 'POST', url: '/api/v1/pricing/quote', payload: { items: [{ variantId: variant, quantity: 3 }], promotionCodes: [] } });
      const line = (res.result as Json).lines[0];
      assert.equal(line.title, 'Contract Wig');
      assert.equal(line.slug, 'oc-wig');
      assert.equal(line.productId, product.id);
      assert.match(line.image.url, /cover\.webp/);
      assert.equal(line.image.altText, 'oc-wig photo');
      assert.deepEqual(line.options, [{ name: 'Length', label: '14"' }, { name: 'Colour', label: 'Jet black' }]);
      assert.equal(line.optionSummary, '14" · Jet black');
      assert.deepEqual([line.compareAtPriceMinor, line.unitPriceMinor, line.availableQuantity], [125000, 100000, 50]);
    });

    it('omit the was-price when there is no offer, and report zero availability rather than negative', async () => {
      const plain = await makeProduct(t, 'oc-plain', { variants: [{ sku: 'OC-P', pick: {}, price: 5000, stock: 0 }] });
      const line = ((await api.inject({ method: 'POST', url: '/api/v1/pricing/quote', payload: { items: [{ variantId: plain.variantIds['OC-P']!, quantity: 1 }], promotionCodes: [] } })).result as Json).lines[0];
      assert.deepEqual([line.compareAtPriceMinor, line.availableQuantity, line.image, line.optionSummary], [null, 0, null, '']);
    });

    it('also come back on the checkout response, and on an idempotent replay of it', async () => {
      const payload = { items: [{ variantId: variant, quantity: 1 }], promotionCodes: [], contact: { phone: phone() }, deliveryAddress: { recipientName: 'Ada Obi', addressLine1: '1 St', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod: 'card', termsAccepted: true };
      const send = () => api.inject({ method: 'POST', url: '/api/v1/checkout', payload, headers: { 'idempotency-key': KEY('replay-lines') } });
      const [first, replay] = [await send(), await send()];
      for (const res of [first, replay]) {
        assert.equal(res.statusCode, 201);
        const line = (res.result as Json).quote.lines[0];
        assert.equal(line.title, 'Contract Wig');
        assert.match(line.image.url, /cover\.webp/);
      }
      assert.equal((replay.result as Json).orderId, (first.result as Json).orderId);
    });
  });

  describe('checkout status (A10)', () => {
    it('adds delivery method, estimate, item count and first name, and still no contact details', async () => {
      const { res, body } = await place({ items: [{ variantId: variant, quantity: 3 }] });
      const cookie = /jh_checkout=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
      const status = (await api.inject({ url: `/api/v1/checkout/${body.orderId}/status`, headers: { cookie: `jh_checkout=${cookie}` } })).result as Json;
      assert.equal(status.deliveryMethod, 'next_day');
      assert.deepEqual(status.estimate, { earliestDate: lagosDate(1), latestDate: lagosDate(1) });
      assert.equal(status.itemCount, 3);
      assert.equal(status.recipientFirstName, 'Ada');
      assert.ok(!JSON.stringify(status).includes('+234') && !JSON.stringify(status).includes('1 St'));
    });

    it('has no delivery window for pickup', async () => {
      const { res, body } = await place({ deliveryMethod: 'pickup' });
      const cookie = /jh_checkout=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
      assert.equal(((await api.inject({ url: `/api/v1/checkout/${body.orderId}/status`, headers: { cookie: `jh_checkout=${cookie}` } })).result as Json).estimate, null);
    });
  });

  describe('customer order detail (A2)', () => {
    let customer: { token: string; id: string };
    const bearer = () => ({ authorization: `Bearer ${customer.token}` });
    const mine = (id: string) => api.inject({ url: `/api/v1/me/orders/${id}`, headers: bearer() }).then((r) => r.result as Json);

    before(async () => {
      const reg = await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: `c${Math.random().toString(36).slice(2)}@example.com`, phone: phone(), password: 'correct horse battery' } });
      customer = { token: (reg.result as Json).accessToken, id: (reg.result as Json).customer.id };
    });

    it('lets the client link, show and review each line, only once delivered', async () => {
      const line = [{ productId: product.id, variantId: variant, quantity: 1 }];
      const placed = await paidOrder(t, line, { customerId: customer.id, status: 'placed' });
      const delivered = await paidOrder(t, line, { customerId: customer.id, status: 'delivered' });

      const early = await mine(placed.id);
      assert.equal(early.items[0].reviewable, false);
      const d = await mine(delivered.id);
      const item = d.items[0];
      assert.match(item.id, /^[0-9a-f-]{36}$/);
      assert.equal(item.slug, 'oc-wig');
      assert.match(item.image.url, /cover\.webp/);
      assert.equal(item.reviewable, true);
      assert.deepEqual(d.estimate, { earliestDate: lagosDate(1), latestDate: lagosDate(1) });

      // The id is exactly what the review endpoint wants, and the line stops being reviewable afterwards.
      const review = await api.inject({ method: 'POST', url: '/api/v1/reviews', payload: { orderItemId: item.id, rating: 5, title: 'Love it' }, headers: bearer() });
      assert.equal(review.statusCode, 201, JSON.stringify(review.result));
      assert.equal((await mine(delivered.id)).items[0].reviewable, false);
    });

    it('shows the rider only while the order is out for delivery', async () => {
      const o = await paidOrder(t, [{ productId: product.id, variantId: variant, quantity: 1 }], { customerId: customer.id, status: 'packed' });
      assert.equal((await mine(o.id)).rider, null);
      assert.equal((await admin('PATCH', `/admin/orders/${o.id}/delivery`, { riderName: 'Musa', riderPhoneE164: '+2348011122233', carrier: 'GIG' }, fulfilment)).status, 200);
      assert.equal((await mine(o.id)).rider, null, 'assigned but not yet on the way');
      await t.db.update(orders).set({ status: 'out_for_delivery' }).where(eq(orders.id, o.id));
      assert.deepEqual((await mine(o.id)).rider, { name: 'Musa', phone: '+2348011122233', carrier: 'GIG', trackingReference: null });
      await t.db.update(orders).set({ status: 'delivered' }).where(eq(orders.id, o.id));
      assert.equal((await mine(o.id)).rider, null);
    });
  });

  describe('admin order list (A8)', () => {
    it('previews up to three lines with photos and counts items', async () => {
      const other = await makeProduct(t, 'oc-other', { cover: true, variants: [{ sku: 'OC-O', pick: {}, price: 2000, stock: 9 }] });
      const o = await paidOrder(t, [{ productId: product.id, variantId: variant, quantity: 2 }, { productId: other.id, variantId: other.variantIds['OC-O']!, quantity: 1 }]);
      const list = await admin('GET', `/admin/orders?q=${o.orderNumber}`);
      const row = list.body.data[0];
      assert.equal(row.itemCount, 3);
      assert.equal(row.items.length, 2);
      assert.ok(row.items.every((i: Json) => /cover\.webp/.test(i.image.url) && i.quantity > 0 && i.title));
    });
  });

  describe('cancelling (A8)', () => {
    it('frees the stock, closes the payment and tells the customer when an order was never paid', async () => {
      const before = (await stock()).reservedQuantity;
      const { body } = await place({ items: [{ variantId: variant, quantity: 4 }] });
      assert.equal((await stock()).reservedQuantity, before + 4);

      const res = await admin('POST', `/admin/orders/${body.orderId}/cancel`, { reason: 'Customer changed their mind' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.order.status, res.body.order.paymentStatus], ['cancelled', 'failed']);
      assert.equal((await stock()).reservedQuantity, before, 'the hold is released');
      assert.ok((await t.db.select().from(stockReservations).where(eq(stockReservations.orderId, body.orderId))).every((r) => r.releasedAt));
      assert.equal((await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, body.orderId)))[0]!.status, 'expired');
      const msgs = (await t.db.select().from(notificationOutbox)).filter((m) => (m.payload as Json).orderId === body.orderId && m.eventType === 'order.cancelled');
      assert.equal((msgs[0]!.payload as Json).refundDue, false);
      assert.equal((await t.db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, body.orderId))).at(-1)!.note, 'Customer changed their mind');
      assert.equal((await admin('POST', `/admin/orders/${body.orderId}/cancel`, { reason: 'Again please' })).status, 409);
    });

    it('puts goods back for a paid order, leaves the refund to the refund endpoint, and can skip restocking', async () => {
      const a = await place();
      await pay(a.body.reference);
      const afterSale = (await stock()).onHandQuantity;
      const res = await admin('POST', `/admin/orders/${a.body.orderId}/cancel`, { reason: 'Out of the ordered length' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.order.status, res.body.order.paymentStatus], ['cancelled', 'paid'], 'money is still owed back');
      assert.equal((await stock()).onHandQuantity, afterSale + 2);
      const movement = (await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, a.body.orderId))).find((m) => m.reason === 'cancellation');
      assert.equal(movement!.quantityDelta, 2);
      assert.equal(((await t.db.select().from(notificationOutbox)).find((m) => (m.payload as Json).orderId === a.body.orderId && m.eventType === 'order.cancelled')!.payload as Json).refundDue, true);

      const refund = await api.inject({ method: 'POST', url: `/api/v1/admin/orders/${a.body.orderId}/refunds`, payload: { reason: 'Order cancelled' }, headers: { ...owner.headers, 'idempotency-key': KEY('cancel-refund') } });
      assert.equal(refund.statusCode, 201, JSON.stringify(refund.result));
      assert.equal((refund.result as Json).orderStatus, 'refunded');

      const b = await place();
      await pay(b.body.reference);
      const kept = (await stock()).onHandQuantity;
      await admin('POST', `/admin/orders/${b.body.orderId}/cancel`, { reason: 'Damaged in the studio', restock: false });
      assert.equal((await stock()).onHandQuantity, kept, 'nothing returned to the shelf');
    });

    it('is refused once an order is on its way, and for roles without orders:cancel', async () => {
      const o = await paidOrder(t, [{ productId: product.id, variantId: variant, quantity: 1 }], { status: 'out_for_delivery' });
      const res = await admin('POST', `/admin/orders/${o.id}/cancel`, { reason: 'Too late for this' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'INVALID_TRANSITION');
      const placed = await paidOrder(t, [{ productId: product.id, variantId: variant, quantity: 1 }]);
      assert.equal((await admin('POST', `/admin/orders/${placed.id}/cancel`, { reason: 'Not allowed here' }, fulfilment)).status, 403);
      assert.equal((await admin('POST', `/admin/orders/${placed.id}/cancel`, { reason: 'x' })).status, 422, 'a real reason is required');
      assert.equal((await admin('POST', `/admin/orders/${placed.id}/cancel`, { reason: 'Managers may cancel' }, manager)).status, 200);
      const audit = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, placed.id))).map((a) => a.action);
      assert.deepEqual(audit, ['order.cancel']);
    });
  });

  describe('delivery details (A8)', () => {
    it('records the rider and tracking, clears fields with blanks, validates the phone, and refuses closed orders', async () => {
      const o = await paidOrder(t, [{ productId: product.id, variantId: variant, quantity: 1 }], { status: 'packed' });
      const set = await admin('PATCH', `/admin/orders/${o.id}/delivery`, { riderName: 'Musa', riderPhoneE164: '+2348011122233', trackingReference: 'TRK-1', estimatedDeliveryAt: '2026-11-01T14:00:00Z' }, fulfilment);
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(set.body.riderName, 'Musa');
      const cleared = await admin('PATCH', `/admin/orders/${o.id}/delivery`, { trackingReference: '' });
      assert.equal(cleared.body.trackingReference, null);
      assert.equal(cleared.body.riderName, 'Musa', 'unsent fields are untouched');
      assert.equal((await admin('PATCH', `/admin/orders/${o.id}/delivery`, { riderPhoneE164: '0801' })).status, 422);
      assert.equal((await admin('PATCH', `/admin/orders/${o.id}/delivery`, {})).status, 422);
      assert.equal((await t.db.select().from(deliveries).where(eq(deliveries.orderId, o.id))).length, 1);
      const closed = await paidOrder(t, [{ productId: product.id, variantId: variant, quantity: 1 }], { status: 'delivered' });
      assert.equal((await admin('PATCH', `/admin/orders/${closed.id}/delivery`, { riderName: 'Late' })).status, 409);
      assert.equal((await admin('GET', `/admin/orders/${o.id}`)).body.delivery.riderName, 'Musa');
    });
  });
});
