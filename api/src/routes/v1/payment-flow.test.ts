import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { and, eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import {
  deliveryZones,
  inventory,
  inventoryMovements,
  notificationOutbox,
  orders,
  orderStatusEvents,
  paymentAttempts,
  paymentWebhookEvents,
  productVariants,
  products,
  promotionCodes,
  promotionHolds,
  promotionRedemptions,
  promotions,
  customers,
  stockReservations,
} from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { checkout, type CheckoutInput } from '../../modules/checkout/checkout.js';
import { releaseExpiredReservations } from '../../modules/inventory/reservations.js';
import { priceCart } from '../../modules/pricing/cart.js';
import { createServer } from '../../server.js';
import { FakeProvider } from '../../testing/fake-provider.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { createWebhookServer } from '../../webhook/server.js';

type Json = Record<string, any>;
const SECRET = 'whsec_test_secret_value';

describe('payment confirmation, retry and webhook', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let hooks: Server;
  const provider = new FakeProvider();
  const v: Record<string, string> = {};
  let n = 0;
  let welcomeId = '';
  let welcomeCodeId = '';

  const address = { recipientName: 'Buyer', addressLine1: '12 Example Street', area: 'Lekki', city: 'Lagos', state: 'Lagos', countryCode: 'NG' };
  const body = (over: Json = {}) => ({
    items: [{ variantId: v.wig, quantity: 1 }],
    promotionCodes: ['WELCOME'],
    contact: { email: 'buyer@example.com', phone: '+2348012345678' },
    deliveryAddress: address,
    deliveryMethod: 'next_day',
    paymentMethod: 'card',
    termsAccepted: true,
    ...over,
  });
  const key = () => `flow-key-${String(++n).padStart(6, '0')}-abcdefgh`;

  async function place(over: Json = {}): Promise<Json & { cookie: string }> {
    const res = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: body(over), headers: { 'idempotency-key': key() } });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    return { ...(res.result as Json), cookie };
  }
  const verify = async (reference: string) => {
    const res = await api.inject({ method: 'POST', url: '/api/v1/checkout/paystack/verify', payload: { reference } });
    return { status: res.statusCode, body: res.result as Json };
  };
  const status = async (orderId: string, cookie?: string) => {
    const res = await api.inject({ method: 'GET', url: `/api/v1/checkout/${orderId}/status`, headers: cookie ? { cookie } : {} });
    return { status: res.statusCode, body: res.result as Json };
  };
  const retry = async (orderId: string, cookie?: string, k = key()) => {
    const res = await api.inject({ method: 'POST', url: `/api/v1/checkout/${orderId}/payment-attempts`, headers: { 'idempotency-key': k, ...(cookie ? { cookie } : {}) } });
    return { status: res.statusCode, body: res.result as Json, key: k };
  };
  const sign = (raw: string, secret = SECRET) => createHmac('sha512', secret).update(raw).digest('hex');
  const webhook = async (event: Json, opts: { secret?: string; raw?: string } = {}) => {
    const raw = opts.raw ?? JSON.stringify(event);
    const res = await hooks.inject({ method: 'POST', url: '/webhooks/paystack', payload: raw, headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(raw, opts.secret) } });
    return { status: res.statusCode, body: res.result as Json };
  };
  const chargeSuccess = (reference: string, id = '1') => ({ event: 'charge.success', data: { id: Number(id), reference, status: 'success', amount: 1, currency: 'NGN', customer: { email: 'secret@pii.test' } } });

  const stock = async (id: string) => (await t.db.select().from(inventory).where(eq(inventory.variantId, id)))[0]!;
  const order = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const attempt = async (ref: string) => (await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.providerReference, ref)))[0]!;
  const redemptions = async (orderId: string) => t.db.select().from(promotionRedemptions).where(eq(promotionRedemptions.orderId, orderId));
  const welcome = async () => (await t.db.select().from(promotions).where(eq(promotions.id, welcomeId)))[0]!;
  const welcomeCode = async () => (await t.db.select().from(promotionCodes).where(eq(promotionCodes.id, welcomeCodeId)))[0]!;
  const expire = async (orderId: string) => {
    const past = new Date(Date.now() - 60_000);
    await t.db.update(stockReservations).set({ expiresAt: past }).where(eq(stockReservations.orderId, orderId));
    await t.db.update(orders).set({ reservationExpiresAt: past }).where(eq(orders.id, orderId));
    await releaseExpiredReservations(t.db);
  };

  async function variant(key: string, price: number, stockQty: number) {
    const [p] = await t.db.insert(products).values({ slug: key, title: key, status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: p!.id, sku: key, optionSignature: {}, priceMinor: price }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: stockQty });
    v[key] = pv!.id;
  }

  before(async () => {
    t = await createTestDatabase();
    const env = loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' });
    api = await createServer({ env, logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    hooks = await createWebhookServer({ env, database: t, payments: provider, signingSecret: SECRET, logger: createLogger('error') });
    await hooks.initialize();

    await variant('wig', 100000, 1000);
    await variant('limited', 100000, 1000);
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
    const [promo] = await t.db.insert(promotions).values({ name: 'Welcome', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 20000 }, status: 'active' }).returning();
    welcomeId = promo!.id;
    const [code] = await t.db.insert(promotionCodes).values({ promotionId: promo!.id, code: 'WELCOME' }).returning();
    welcomeCodeId = code!.id;
  });

  beforeEach(() => provider.reset());

  after(async () => {
    await api?.stop();
    await hooks?.stop();
    await t?.destroy();
  });

  describe('verification and settlement', () => {
    it('keeps the order pending and claims nothing while the provider reports the payment as unpaid', async () => {
      const used = (await welcome()).usageCount;
      const placed = await place();
      const res = await verify(placed.reference);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'pending_payment');
      assert.equal(res.body.paymentStatus, 'pending');
      assert.equal((await redemptions(placed.orderId)).length, 0);
      assert.equal((await welcome()).usageCount, used);
    });

    it('confirms payment once: places the order, consumes stock, claims promotions, queues a notification', async () => {
      const usedBefore = (await welcome()).usageCount;
      const codeBefore = (await welcomeCode()).redemptionCount;
      const before = await stock(v.wig!);
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });

      const res = await verify(placed.reference);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'placed');
      assert.equal(res.body.paymentStatus, 'paid');
      assert.equal(res.body.paymentAttempt.status, 'succeeded');
      assert.deepEqual(Object.keys(res.body).sort(), ['amountMinor', 'currency', 'orderId', 'orderNumber', 'paymentAttempt', 'paymentStatus', 'reservationExpiresAt', 'status']);

      const o = await order(placed.orderId);
      assert.ok(o.placedAt);
      const after = await stock(v.wig!);
      assert.equal(after.onHandQuantity, before.onHandQuantity - 1);
      assert.equal(after.reservedQuantity, before.reservedQuantity);
      const [reservation] = await t.db.select().from(stockReservations).where(eq(stockReservations.orderId, o.id));
      assert.ok(reservation!.consumedAt);
      const movements = await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, o.id));
      assert.deepEqual(movements.map((m) => [m.reason, m.quantityDelta]), [['sale', -1]]);

      const redeemed = await redemptions(o.id);
      assert.equal(redeemed.length, 1);
      assert.equal(redeemed[0]!.promotionCodeId, welcomeCodeId);
      assert.equal(redeemed[0]!.discountMinor, 20000);
      assert.equal((await welcome()).usageCount, usedBefore + 1);
      assert.equal((await welcomeCode()).redemptionCount, codeBefore + 1);

      const events = await t.db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, o.id));
      assert.deepEqual(events.map((e) => e.toStatus).sort(), ['pending_payment', 'placed']);
      const outbox = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'order.placed'));
      assert.ok(outbox.some((m) => (m.payload as Json).orderId === o.id));
      assert.equal((await attempt(placed.reference)).providerTransactionId !== null, true);
    });

    it('is idempotent across repeated verification and concurrent webhook plus verify calls', async () => {
      const usedBefore = (await welcome()).usageCount;
      const before = await stock(v.wig!);
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });

      await Promise.all([
        verify(placed.reference),
        verify(placed.reference),
        webhook(chargeSuccess(placed.reference, '77')),
        webhook(chargeSuccess(placed.reference, '77')),
        webhook(chargeSuccess(placed.reference, '77')),
      ]);
      await verify(placed.reference);

      assert.equal((await order(placed.orderId)).status, 'placed');
      assert.equal((await redemptions(placed.orderId)).length, 1);
      assert.equal((await welcome()).usageCount, usedBefore + 1);
      assert.equal((await stock(v.wig!)).onHandQuantity, before.onHandQuantity - 1);
      assert.equal((await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, placed.orderId))).length, 1);
      assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'order.placed'))).filter((m) => (m.payload as Json).orderId === placed.orderId).length, 2, 'one SMS and one email, not duplicated');
    });

    it('returns 404 for an unknown reference and 503 when the provider cannot be reached', async () => {
      assert.equal((await verify('jh_does_not_exist_123')).status, 404);
      const placed = await place();
      provider.verifyDown = true;
      const res = await verify(placed.reference);
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'PAYMENT_VERIFICATION_UNAVAILABLE');
      assert.equal((await order(placed.orderId)).status, 'pending_payment');
    });

    it('marks the attempt failed on a definitive provider failure without failing the order', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'failed' });
      const res = await verify(placed.reference);
      assert.equal(res.body.paymentAttempt.status, 'failed');
      assert.equal(res.body.status, 'pending_payment');
      assert.equal(res.body.paymentStatus, 'pending');
      assert.equal((await redemptions(placed.orderId)).length, 0);
    });

    it('never regresses a confirmed payment on a late failure report', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      await verify(placed.reference);
      provider.set(placed.reference, { status: 'failed' });
      const res = await verify(placed.reference);
      assert.equal(res.body.status, 'placed');
      assert.equal(res.body.paymentAttempt.status, 'succeeded');
    });

    it('flags an amount mismatch as a payment exception and claims nothing', async () => {
      const usedBefore = (await welcome()).usageCount;
      const placed = await place();
      provider.set(placed.reference, { status: 'success', amountMinor: placed.amountMinor - 1 });
      const res = await verify(placed.reference);
      assert.equal(res.body.status, 'payment_exception');
      assert.equal((await redemptions(placed.orderId)).length, 0);
      assert.equal((await welcome()).usageCount, usedBefore);
      assert.notEqual((await attempt(placed.reference)).status, 'succeeded');
      const alerts = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'payment.exception'));
      assert.ok(alerts.some((a) => (a.payload as Json).orderId === placed.orderId && (a.payload as Json).reason === 'AMOUNT_MISMATCH'));
    });

    it('flags a currency mismatch the same way', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success', currency: 'USD' });
      assert.equal((await verify(placed.reference)).body.status, 'payment_exception');
    });
  });

  describe('promotions are claimed only after confirmed payment', () => {
    it('holds a limited slot first come first served; usage is claimed only on payment', async () => {
      const [limited] = await t.db.insert(promotions).values({ name: 'One only', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 10000 }, status: 'active', totalUsageLimit: 1 }).returning();
      await t.db.insert(promotionCodes).values({ promotionId: limited!.id, code: 'ONLYONE' });
      const usage = async () => (await t.db.select().from(promotions).where(eq(promotions.id, limited!.id)))[0]!.usageCount;
      const holds = async () => (await t.db.select().from(promotionHolds).where(eq(promotionHolds.promotionId, limited!.id))).length;

      const first = await place({ promotionCodes: ['ONLYONE'] });
      assert.equal((await order(first.orderId)).discountMinor, 10000);
      assert.equal(await usage(), 0, 'not claimed before payment');
      assert.equal(await holds(), 1);

      // The slot is taken while the first shopper is paying, so the second does not get it.
      const second = await place({ promotionCodes: ['ONLYONE'] });
      assert.equal((await order(second.orderId)).discountMinor, 0);
      assert.deepEqual(second.quote.promotions.rejectedCodes, [{ code: 'ONLYONE', reason: 'USAGE_LIMIT_REACHED' }]);

      provider.set(first.reference, { status: 'success' });
      assert.equal((await verify(first.reference)).body.status, 'placed');
      assert.equal(await usage(), 1);
      assert.equal(await holds(), 0, 'hold became a redemption');
      assert.equal((await redemptions(first.orderId)).length, 1);

      // The second shopper was never promised the discount, and still pays and is fulfilled.
      provider.set(second.reference, { status: 'success' });
      assert.equal((await verify(second.reference)).body.status, 'placed');
      assert.equal(await usage(), 1);
    });

    it('frees the slot when the holder never pays, so the next shopper gets it', async () => {
      const [limited] = await t.db.insert(promotions).values({ name: 'Slot', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 10000 }, status: 'active', totalUsageLimit: 1 }).returning();
      await t.db.insert(promotionCodes).values({ promotionId: limited!.id, code: 'SLOT' });
      const holder = await place({ promotionCodes: ['SLOT'] });
      assert.equal((await place({ promotionCodes: ['SLOT'] })).quote.promotions.applied.length, 0);

      await expire(holder.orderId);
      assert.equal((await t.db.select().from(promotionHolds).where(eq(promotionHolds.promotionId, limited!.id))).length, 0);
      const next = await place({ promotionCodes: ['SLOT'] });
      assert.equal((await order(next.orderId)).discountMinor, 10000);
    });

    it('never oversubscribes a limit under concurrent checkouts', async () => {
      const [limited] = await t.db.insert(promotions).values({ name: 'Race', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 10000 }, status: 'active', totalUsageLimit: 2 }).returning();
      const [code] = await t.db.insert(promotionCodes).values({ promotionId: limited!.id, code: 'RACE', maxRedemptions: 2 }).returning();
      const input: CheckoutInput = {
        items: [{ variantId: v.wig!, quantity: 1 }],
        promotionCodes: ['RACE'],
        contact: { email: 'race@example.com', phone: '+2348012345678' },
        deliveryAddress: address,
        deliveryMethod: 'next_day',
        paymentMethod: 'card',
      };
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => checkout(t.db, provider, input, { emailDomain: 'noemail.test' })));
      const placed = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof checkout>>> => r.status === 'fulfilled');
      for (const r of results) {
        if (r.status === 'rejected') assert.equal((r.reason as { data?: { code?: string } }).data?.code ?? (r.reason as { output?: { payload?: { error?: { code?: string } } } }).output?.payload?.error?.code, 'PROMOTION_UNAVAILABLE');
      }
      const discounted = placed.filter((r) => (r.value as { body?: { quote?: { discountMinor: number } } }).body?.quote?.discountMinor === 10000);
      assert.equal(discounted.length, 2, 'exactly the limit gets the discount');

      for (const r of discounted) {
        const ref = (r.value as { body: Json }).body.reference as string;
        provider.set(ref, { status: 'success' });
        await verify(ref);
      }
      const [row] = await t.db.select().from(promotions).where(eq(promotions.id, limited!.id));
      const [codeRow] = await t.db.select().from(promotionCodes).where(eq(promotionCodes.id, code!.id));
      assert.equal(row!.usageCount, 2);
      assert.equal(codeRow!.redemptionCount, 2);
    });

    it('never claims promotions for an order that expires unpaid', async () => {
      const usedBefore = (await welcome()).usageCount;
      const placed = await place();
      await expire(placed.orderId);
      assert.equal((await redemptions(placed.orderId)).length, 0);
      assert.equal((await welcome()).usageCount, usedBefore);
    });

    it('records the customer on redemptions and enforces per-customer limits afterwards', async () => {
      const [customer] = await t.db.insert(customers).values({ email: 'member@example.com' }).returning();
      const [perCustomer] = await t.db.insert(promotions).values({ name: 'Once each', kind: 'percentage', configuration: { version: 1, percent: 10 }, status: 'active', perCustomerLimit: 1 }).returning();
      await t.db.insert(promotionCodes).values({ promotionId: perCustomer!.id, code: 'ONCEEACH' });

      const input: CheckoutInput = {
        items: [{ variantId: v.wig!, quantity: 1 }],
        promotionCodes: ['ONCEEACH'],
        contact: { email: 'member@example.com', phone: '+2348012345678' },
        deliveryAddress: address,
        deliveryMethod: 'next_day',
        paymentMethod: 'card',
      };
      const result = await checkout(t.db, provider, input, { customerId: customer!.id, emailDomain: 'noemail.test' });
      assert.equal(result.status, 201);
      const reference = (result as { body: Json }).body.reference as string;

      // The unpaid order already holds the customer's only use.
      const during = await priceCart(t.db, { items: input.items, promotionCodes: ['ONCEEACH'], customerId: customer!.id });
      assert.deepEqual(during.promotions.rejectedCodes, [{ code: 'ONCEEACH', reason: 'USAGE_LIMIT_REACHED' }]);
      const concurrent = await checkout(t.db, provider, input, { customerId: customer!.id, emailDomain: 'noemail.test' });
      assert.equal((concurrent as { body: Json }).body.quote.discountMinor, 0);

      provider.set(reference, { status: 'success' });
      const res = await verify(reference);
      assert.equal(res.body.status, 'placed');
      const [redemption] = await t.db.select().from(promotionRedemptions).where(eq(promotionRedemptions.promotionId, perCustomer!.id));
      assert.equal(redemption!.customerId, customer!.id);

      const after = await priceCart(t.db, { items: input.items, promotionCodes: ['ONCEEACH'], customerId: customer!.id });
      assert.deepEqual(after.promotions.rejectedCodes, [{ code: 'ONCEEACH', reason: 'USAGE_LIMIT_REACHED' }]);
    });
  });

  describe('late and duplicate charges', () => {
    it('records a charge that arrives after expiry as a payment exception without fulfilling released stock', async () => {
      const usedBefore = (await welcome()).usageCount;
      const placed = await place();
      const stockBefore = await stock(v.wig!);
      await expire(placed.orderId);

      let o = await order(placed.orderId);
      assert.equal(o.status, 'cancelled');
      assert.equal(o.paymentStatus, 'failed');
      assert.equal((await attempt(placed.reference)).status, 'expired');
      assert.equal((await stock(v.wig!)).reservedQuantity, stockBefore.reservedQuantity - 1);

      provider.set(placed.reference, { status: 'success' });
      const res = await verify(placed.reference);
      assert.equal(res.body.status, 'payment_exception');
      assert.equal(res.body.paymentStatus, 'paid');
      o = await order(placed.orderId);
      assert.equal(o.status, 'payment_exception');
      assert.equal((await attempt(placed.reference)).status, 'succeeded', 'the charge is never discarded');
      assert.equal((await stock(v.wig!)).onHandQuantity, stockBefore.onHandQuantity, 'no stock consumed');
      assert.equal((await redemptions(placed.orderId)).length, 0);
      assert.equal((await welcome()).usageCount, usedBefore);
      const alerts = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'payment.exception'));
      assert.ok(alerts.some((a) => (a.payload as Json).orderId === placed.orderId && (a.payload as Json).reason === 'LATE_PAYMENT'));
    });

    it('records a second successful charge on an already paid order without disturbing it', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'failed' });
      await verify(placed.reference);
      const second = await retry(placed.orderId, placed.cookie);
      assert.equal(second.status, 201);

      provider.set(second.body.reference, { status: 'success' });
      assert.equal((await verify(second.body.reference)).body.status, 'placed');

      // The first attempt is later reported as paid too (e.g. the shopper completed both tabs).
      provider.set(placed.reference, { status: 'success' });
      const dup = await verify(placed.reference);
      assert.equal(dup.body.status, 'placed');
      assert.equal((await attempt(placed.reference)).status, 'succeeded');
      assert.equal((await redemptions(placed.orderId)).length, 1);
      assert.equal((await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, placed.orderId))).length, 1);
      const alerts = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'payment.exception'));
      assert.ok(alerts.some((a) => (a.payload as Json).orderId === placed.orderId && (a.payload as Json).reason === 'DUPLICATE_CHARGE'));
    });
  });

  describe('expiry', () => {
    it('cancels unpaid orders and expires attempts exactly once', async () => {
      const placed = await place();
      await expire(placed.orderId);
      const events = await t.db.select().from(orderStatusEvents).where(and(eq(orderStatusEvents.orderId, placed.orderId), eq(orderStatusEvents.toStatus, 'cancelled')));
      assert.equal(events.length, 1);
      assert.equal(await releaseExpiredReservations(t.db), 0);
    });

    it('leaves a paid order alone', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      await verify(placed.reference);
      await expire(placed.orderId);
      assert.equal((await order(placed.orderId)).status, 'placed');
    });
  });

  describe('GET /checkout/{orderId}/status', () => {
    it('returns minimal status only to the owning guest', async () => {
      const placed = await place();
      const other = await place();
      const ok = await status(placed.orderId, placed.cookie);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.orderNumber, placed.orderNumber);
      assert.ok(!JSON.stringify(ok.body).includes('buyer@example.com'));

      assert.equal((await status(placed.orderId)).status, 404);
      assert.equal((await status(placed.orderId, other.cookie)).status, 404);
      assert.equal((await status(placed.orderId, 'jh_checkout=garbage')).status, 404);
      assert.equal((await status('00000000-0000-4000-8000-000000000000', placed.cookie)).status, 404);
      assert.equal((await status('not-a-uuid', placed.cookie)).status, 422);
    });

    it('rejects an expired guest token', async () => {
      const placed = await place();
      await t.db.update(orders).set({ guestCheckoutTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, placed.orderId));
      assert.equal((await status(placed.orderId, placed.cookie)).status, 404);
    });

    it('reflects payment as soon as it is confirmed', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      await webhook(chargeSuccess(placed.reference, '501'));
      const res = await status(placed.orderId, placed.cookie);
      assert.equal(res.body.status, 'placed');
      assert.equal(res.body.paymentStatus, 'paid');
    });
  });

  describe('POST /checkout/{orderId}/payment-attempts', () => {
    it('refuses while the previous attempt is still active, and without the owner token', async () => {
      const placed = await place();
      const active = await retry(placed.orderId, placed.cookie);
      assert.equal(active.status, 409);
      assert.equal(active.body.error.code, 'PAYMENT_ATTEMPT_ACTIVE');
      assert.equal((await retry(placed.orderId)).status, 404);
      assert.equal((await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, placed.orderId))).length, 1);
    });

    it('creates a new attempt with a new reference after a definitive failure, and replays idempotently', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'failed' });
      const first = await retry(placed.orderId, placed.cookie);
      assert.equal(first.status, 201);
      assert.notEqual(first.body.reference, placed.reference);
      assert.equal(first.body.orderId, placed.orderId);
      assert.equal(first.body.amountMinor, placed.amountMinor);
      assert.equal((await attempt(placed.reference)).status, 'failed');
      assert.equal((await attempt(first.body.reference)).status, 'pending');

      const replay = await retry(placed.orderId, placed.cookie, first.key);
      assert.equal(replay.status, 201);
      assert.equal(replay.body.reference, first.body.reference);
      assert.equal((await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, placed.orderId))).length, 2);

      // Only one active attempt may exist.
      assert.equal((await retry(placed.orderId, placed.cookie)).status, 409);
    });

    it('reconciles an attempt that was actually paid instead of starting a second one', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      const res = await retry(placed.orderId, placed.cookie);
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'ORDER_ALREADY_PAID');
      assert.equal((await order(placed.orderId)).status, 'placed');
    });

    it('abandons an attempt the provider never saw, but only once it can no longer be in flight', async () => {
      provider.initializeMode = 'timeout';
      const res = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: body(), headers: { 'idempotency-key': key() } });
      assert.equal(res.statusCode, 502);
      const orderId = (res.result as Json).error.details[0].orderId as string;
      const cookie = String(res.headers['set-cookie']).split(';')[0]!;
      provider.reset();

      const tooSoon = await retry(orderId, cookie);
      assert.equal(tooSoon.status, 409);
      assert.equal(tooSoon.body.error.code, 'PAYMENT_ATTEMPT_ACTIVE');

      await t.db.update(paymentAttempts).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(paymentAttempts.orderId, orderId));
      const later = await retry(orderId, cookie);
      assert.equal(later.status, 201);
    });

    it('reconciles an initializing attempt that the provider did create', async () => {
      provider.initializeMode = 'timeout';
      const res = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: body(), headers: { 'idempotency-key': key() } });
      const orderId = (res.result as Json).error.details[0].orderId as string;
      const cookie = String(res.headers['set-cookie']).split(';')[0]!;
      const [a] = await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId));
      provider.reset();
      provider.set(a!.providerReference, { status: 'success', amountMinor: a!.amountMinor });

      const retried = await retry(orderId, cookie);
      assert.equal(retried.body.error.code, 'ORDER_ALREADY_PAID');
      assert.equal((await order(orderId)).status, 'placed');
    });

    it('refuses once the reservation has expired', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'failed' });
      await expire(placed.orderId);
      const res = await retry(placed.orderId, placed.cookie);
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'ORDER_NOT_PAYABLE');
    });

    it('surfaces a provider refusal on retry as a retryable 502', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'failed' });
      provider.initializeMode = 'reject';
      const res = await retry(placed.orderId, placed.cookie);
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'PAYMENT_INITIALIZATION_FAILED');
      provider.reset();
      assert.equal((await retry(placed.orderId, placed.cookie)).status, 201);
    });
  });

  describe('webhook service', () => {
    it('is a separate server: the public API does not expose the webhook route', async () => {
      const res = await api.inject({ method: 'POST', url: '/api/v1/webhooks/paystack', payload: '{}' });
      assert.equal(res.statusCode, 404);
      const bare = await api.inject({ method: 'POST', url: '/webhooks/paystack', payload: '{}' });
      assert.equal(bare.statusCode, 404);
      assert.equal((await hooks.inject({ method: 'GET', url: '/api/v1/products' })).statusCode, 404);
      assert.equal((await hooks.inject({ method: 'GET', url: '/healthz' })).statusCode, 200);
      assert.equal((await hooks.inject({ method: 'GET', url: '/readyz' })).statusCode, 200);
    });

    it('rejects missing, malformed and wrong signatures without changing state', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      const raw = JSON.stringify(chargeSuccess(placed.reference));

      const wrongKey = await webhook({}, { raw, secret: 'a-different-secret' });
      assert.equal(wrongKey.status, 401);
      const none = await hooks.inject({ method: 'POST', url: '/webhooks/paystack', payload: raw });
      assert.equal(none.statusCode, 401);
      const junk = await hooks.inject({ method: 'POST', url: '/webhooks/paystack', payload: raw, headers: { 'x-paystack-signature': 'zz' } });
      assert.equal(junk.statusCode, 401);
      const tampered = await hooks.inject({ method: 'POST', url: '/webhooks/paystack', payload: raw.replace('success', 'Success'), headers: { 'x-paystack-signature': sign(raw) } });
      assert.equal(tampered.statusCode, 401);

      assert.equal((await order(placed.orderId)).status, 'pending_payment');
      assert.equal((await t.db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.providerEventKey, `charge.success:${placed.reference}:1`))).length, 0);
    });

    it('verifies with the provider and ignores what the body claims', async () => {
      const placed = await place();
      // Provider says unpaid even though the signed body says success.
      const res = await webhook(chargeSuccess(placed.reference, '9001'));
      assert.equal(res.status, 200);
      assert.equal(res.body.outcome, 'pending');
      assert.equal((await order(placed.orderId)).status, 'pending_payment');
      assert.ok(provider.verifyCalls >= 1);
    });

    it('settles a verified payment, stores only a redacted event, and deduplicates redelivery', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      const first = await webhook(chargeSuccess(placed.reference, '9002'));
      assert.equal(first.status, 200);
      assert.equal(first.body.outcome, 'paid');
      const again = await webhook(chargeSuccess(placed.reference, '9002'));
      assert.equal(again.body.outcome, 'duplicate');

      const [stored] = await t.db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.providerEventKey, `charge.success:${placed.reference}:9002`));
      assert.ok(stored!.processedAt);
      assert.equal(stored!.processingStatus, 'paid');
      assert.ok(!JSON.stringify(stored!.payloadRedacted).includes('pii.test'));
      assert.equal((await redemptions(placed.orderId)).length, 1);
    });

    it('answers 200 for events it does not act on and for references it does not own', async () => {
      assert.equal((await webhook({ event: 'transfer.success', data: { id: 5, reference: 'x' } })).body.outcome, 'ignored');
      assert.equal((await webhook({ event: 'subscription.create', data: {} })).body.outcome, 'ignored');
      provider.set('jh_not_ours_000001', { status: 'success', amountMinor: 5 });
      assert.equal((await webhook(chargeSuccess('jh_not_ours_000001', '9003'))).body.outcome, 'ignored');
      assert.equal((await webhook({}, { raw: 'not json' })).status, 400);
    });

    it('asks Paystack to redeliver when verification is unavailable, then processes the retry', async () => {
      const placed = await place();
      provider.set(placed.reference, { status: 'success' });
      provider.verifyDown = true;
      const down = await webhook(chargeSuccess(placed.reference, '9004'));
      assert.equal(down.status, 503);
      assert.equal((await order(placed.orderId)).status, 'pending_payment');

      provider.verifyDown = false;
      const retried = await webhook(chargeSuccess(placed.reference, '9004'));
      assert.equal(retried.status, 200);
      assert.equal(retried.body.outcome, 'paid');
      assert.equal((await order(placed.orderId)).status, 'placed');
    });

    it('rejects oversized bodies', async () => {
      const raw = JSON.stringify({ event: 'charge.success', data: { pad: 'x'.repeat(70 * 1024) } });
      const res = await hooks.inject({ method: 'POST', url: '/webhooks/paystack', payload: raw, headers: { 'x-paystack-signature': sign(raw) } });
      assert.equal(res.statusCode, 413);
    });
  });
});
