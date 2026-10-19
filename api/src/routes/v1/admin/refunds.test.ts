import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, deliveryZones, inventory, notificationOutbox, orders, paymentAttempts, productVariants, products, refunds } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { handlePaystackEvent } from '../../../webhook/process.js';
import { FakeProvider } from '../../../testing/fake-provider.js';

type Json = Record<string, any>;

describe('admin refunds and double-payment handling', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let manager: Awaited<ReturnType<typeof signInAdmin>>;
  let fulfilment: Awaited<ReturnType<typeof signInAdmin>>;
  let variantId = '';
  let n = 0;
  let phones = 0;
  const unique = () => `refund-test-${++n}-0123456789abcdefghijklmnopqrstuv`;

  const place = async (paymentMethod: 'card' | 'bank_transfer', email?: string) => {
    const phone = `+23485${String(60_000_000 + ++phones)}`;
    const res = await api.inject({
      method: 'POST', url: '/api/v1/checkout',
      payload: { items: [{ variantId, quantity: 1 }], promotionCodes: [], contact: { phone, ...(email ? { email } : {}) }, deliveryAddress: { recipientName: 'Ada', addressLine1: '1 St', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod, termsAccepted: true },
      headers: { 'idempotency-key': unique() },
    });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return { ...(res.result as Json), phone } as Json;
  };
  const pay = async (reference: string) => {
    provider.set(reference, { status: 'success' });
    assert.equal((await api.inject({ method: 'POST', url: '/api/v1/checkout/paystack/verify', payload: { reference } })).statusCode, 200);
  };
  const refund = (orderId: string, payload: Json, who = owner, key = unique()) =>
    api.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/refunds`, payload, headers: { ...who.headers, 'idempotency-key': key } }).then((r) => ({ status: r.statusCode, body: r.result as Json }));
  const orderRow = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    manager = await signInAdmin(t.db, api, 'manager');
    fulfilment = await signInAdmin(t.db, api, 'fulfilment');
    const [p] = await t.db.insert(products).values({ slug: 'rf-wig', title: 'Refund Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'RF-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 500 });
    variantId = v!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('refunds a paid order in full: provider called once, order and payment marked refunded, customer told, everything audited', async () => {
    provider.reset();
    const o = await place('card', 'ada@example.com');
    await pay(o.reference);
    const res = await refund(o.orderId, { reason: 'Customer returned the wig' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.amountMinor, res.body.orderStatus, res.body.paymentStatus], [250000, 'refunded', 'refunded']);
    assert.deepEqual(provider.refunds.map((r) => [r.reference, r.amountMinor]), [[o.reference, 250000]]);
    const [row] = await t.db.select().from(refunds).where(eq(refunds.orderId, o.orderId));
    assert.deepEqual([row!.status, row!.providerReference, row!.createdByAdminId], ['pending', 'rf_1', owner.id]);

    const messages = (await t.db.select().from(notificationOutbox)).filter((m) => (m.payload as Json).orderId === o.orderId && m.eventType === 'order.refunded');
    assert.deepEqual(messages.map((m) => m.channel).sort(), ['email', 'sms']);
    assert.equal((messages[0]!.payload as Json).amount, '2,500.00');
    const actions = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, o.orderId))).map((a) => a.action).sort();
    assert.deepEqual(actions, ['order.refund.accepted', 'order.refund.request']);

    const track = (await api.inject({ method: 'POST', url: '/api/v1/orders/track', payload: { orderNumber: o.orderNumber, phone: o.phone } })).result as Json;
    assert.deepEqual(track.timeline.map((e: Json) => e.status), ['pending_payment', 'placed', 'refunded']);

    const again = await refund(o.orderId, { reason: 'Second attempt' });
    assert.equal(again.status, 409, 'a refunded order cannot be refunded again');
    assert.equal(provider.refunds.length, 1);
  });

  it('is idempotent: the same key replays the response without a second provider call', async () => {
    provider.reset();
    const o = await place('card');
    await pay(o.reference);
    const key = unique();
    const first = await refund(o.orderId, { amountMinor: 10000, reason: 'Goodwill' }, owner, key);
    const second = await refund(o.orderId, { amountMinor: 10000, reason: 'Goodwill' }, owner, key);
    assert.equal(first.status, 201);
    assert.deepEqual(second.body, first.body);
    assert.equal(provider.refunds.length, 1);
    const reuse = await refund(o.orderId, { amountMinor: 20000, reason: 'Goodwill' }, owner, key);
    assert.equal(reuse.status, 409, 'the key cannot be reused for a different request');
  });

  it('handles partial refunds: the order stays live, the remainder is tracked, and over-refunding is refused', async () => {
    provider.reset();
    const o = await place('card');
    await pay(o.reference);
    const part = await refund(o.orderId, { amountMinor: 100000, reason: 'One unit damaged' });
    assert.deepEqual([part.status, part.body.orderStatus, part.body.paymentStatus], [201, 'placed', 'paid']);
    const tooMuch = await refund(o.orderId, { amountMinor: 150001, reason: 'More than is left' });
    assert.equal(tooMuch.status, 422);
    assert.equal(tooMuch.body.error.code, 'REFUND_AMOUNT_INVALID');
    assert.equal((await refund(o.orderId, { amountMinor: 0, reason: 'Nothing' })).status, 422);
    const rest = await refund(o.orderId, { reason: 'Refund the remainder' });
    assert.deepEqual([rest.status, rest.body.amountMinor, rest.body.orderStatus], [201, 150000, 'refunded']);
  });

  it('refunds only an extra charge when the customer paid twice, leaving the order intact', async () => {
    provider.reset();
    const o = await place('card');
    await pay(o.reference);
    // A second successful charge against the same order (the customer paid again on another attempt).
    const [second] = await t.db.insert(paymentAttempts).values({ orderId: o.orderId, provider: 'paystack', providerReference: `dup_${o.orderId}`, providerTransactionId: 'dup-1', method: 'card', status: 'succeeded', amountMinor: 250000 }).returning();

    const ambiguous = await refund(o.orderId, { reason: 'Charged twice' });
    assert.equal(ambiguous.status, 422);
    assert.equal(ambiguous.body.error.code, 'PAYMENT_ATTEMPT_REQUIRED');
    assert.equal(ambiguous.body.error.details.length, 2);

    const res = await refund(o.orderId, { reason: 'Charged twice', paymentAttemptId: second!.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.orderStatus, res.body.paymentStatus], ['placed', 'paid']);
    assert.equal(provider.refunds[0]!.reference, `dup_${o.orderId}`);
    assert.equal((await refund(o.orderId, { reason: 'x'.repeat(6), paymentAttemptId: '00000000-0000-4000-8000-000000000000' })).status, 422);
  });

  it('flags a real provider charge that follows a hand confirmation, and lets an admin refund just that charge', async () => {
    provider.reset();
    const o = await place('bank_transfer');
    const manual = await api.inject({ method: 'POST', url: `/api/v1/admin/orders/${o.orderId}/confirm-transfer`, payload: { manualReason: 'Statement shows the credit' }, headers: owner.headers });
    assert.equal((manual.result as Json).outcome, 'paid');

    // Hand-confirmed money has no provider charge: nothing to refund through Paystack yet.
    const early = await refund(o.orderId, { reason: 'Try before any charge' });
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'MANUAL_PAYMENT_NOT_REFUNDABLE');

    // The provider's own record of the charge arrives later, by webhook.
    provider.set(o.reference, { status: 'success' });
    const event = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 777, reference: o.reference } }));
    assert.equal((await handlePaystackEvent(t.db, provider, event)).status, 200);
    const alerts = (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'payment.exception'))).filter((a) => (a.payload as Json).orderId === o.orderId);
    assert.deepEqual(alerts.map((a) => (a.payload as Json).reason), ['PROVIDER_CHARGE_AFTER_MANUAL_CONFIRMATION']);
    // A redelivery must not raise the alert twice.
    assert.equal(((await handlePaystackEvent(t.db, provider, event)) as { outcome: string }).outcome, 'duplicate');
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'payment.exception'))).filter((a) => (a.payload as Json).orderId === o.orderId).length, 1);

    const res = await refund(o.orderId, { reason: 'Customer paid twice: bank and card' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.orderStatus, res.body.paymentStatus], ['placed', 'paid'], 'the hand-confirmed payment still covers the order');
  });

  it('releases the amount when the provider refuses, and keeps it reserved when the outcome is unknown', async () => {
    provider.reset();
    const o = await place('card');
    await pay(o.reference);

    provider.refundMode = 'reject';
    const rejected = await refund(o.orderId, { reason: 'Provider says no' });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.error.code, 'REFUND_REJECTED');
    assert.equal((await t.db.select().from(refunds).where(eq(refunds.orderId, o.orderId)))[0]!.status, 'failed');

    provider.refundMode = 'timeout';
    const unknown = await refund(o.orderId, { reason: 'Timeout' });
    assert.equal(unknown.status, 502);
    assert.equal(unknown.body.error.code, 'REFUND_STATUS_UNKNOWN');
    const pending = (await t.db.select().from(refunds).where(eq(refunds.orderId, o.orderId))).filter((r) => r.status === 'pending');
    assert.equal(pending.length, 1);

    provider.refundMode = 'ok';
    const retry = await refund(o.orderId, { reason: 'Retry while one is unconfirmed' });
    assert.equal(retry.status, 422, 'the unconfirmed refund still holds the whole amount, so a second one cannot double-refund');
    assert.equal((await orderRow(o.orderId)).paymentStatus, 'paid');
  });

  it('is limited to roles with orders:refund and requires an Idempotency-Key and a reason', async () => {
    provider.reset();
    const o = await place('card');
    await pay(o.reference);
    assert.equal((await refund(o.orderId, { reason: 'Not allowed' }, fulfilment)).status, 403);
    assert.equal(provider.refunds.length, 0);
    const noKey = await api.inject({ method: 'POST', url: `/api/v1/admin/orders/${o.orderId}/refunds`, payload: { reason: 'No key sent' }, headers: owner.headers });
    assert.equal(noKey.statusCode, 422);
    assert.equal((await refund(o.orderId, {})).status, 422);
    assert.equal((await refund(o.orderId, { reason: 'ok' })).status, 422, 'a reason is at least 5 characters');
    const unpaid = await place('card');
    assert.equal((await refund(unpaid.orderId, { reason: 'Never paid for' })).status, 409);
    assert.equal((await refund(o.orderId, { amountMinor: 5000, reason: 'Managers may refund' }, manager)).status, 201);
  });
});
