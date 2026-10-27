import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import {
  deliveryZones,
  idempotencyKeys,
  inventory,
  orderItems,
  orders,
  paymentAttempts,
  productVariants,
  products,
  promotionCodes,
  promotionRedemptions,
  promotions,
  stockReservations,
} from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { PaymentIndeterminateError, PaymentRejectedError, type InitializeInput } from '../../modules/payments/provider.js';
import { FakeProvider } from '../../testing/fake-provider.js';
import { PaystackProvider } from '../../modules/payments/paystack.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';

type Json = Record<string, any>;

describe('POST /checkout', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let server: Server;
  const provider = new FakeProvider();
  const v: Record<string, string> = {};
  let keyCounter = 0;

  const address = { recipientName: 'Buyer', addressLine1: '12 Example Street', area: 'Lekki', city: 'Lagos', state: 'Lagos', countryCode: 'NG' };
  const base = (over: Json = {}) => ({
    items: [{ variantId: v.wig, quantity: 1 }],
    contact: { email: 'Buyer@Example.com', phone: '+2348012345678' },
    deliveryAddress: address,
    deliveryMethod: 'next_day',
    paymentMethod: 'card',
    termsAccepted: true,
    ...over,
  });
  const submit = async (payload: Json, key = `key-${String(++keyCounter).padStart(4, '0')}-abcdefghij-0123456789abcdefghijklmnopqrstuv`) => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/checkout', payload, headers: { 'idempotency-key': key } });
    return { status: res.statusCode, body: res.result as Json, headers: res.headers, key };
  };

  async function variant(key: string, price: number, stock: number) {
    const [p] = await t.db.insert(products).values({ slug: key, title: `Title ${key}`, status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: p!.id, sku: key, optionSignature: { length: '20in' }, priceMinor: price }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: stock });
    v[key] = pv!.id;
  }
  const stock = async (id: string) => (await t.db.select().from(inventory).where(eq(inventory.variantId, id)))[0]!;

  before(async () => {
    t = await createTestDatabase();
    server = await createServer({
      env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', PAYSTACK_CALLBACK_URL: 'https://shop.test/pay/return' }),
      logger: createLogger('error'),
      database: t,
      payments: provider,
    });
    await server.initialize();

    await variant('wig', 100000, 10);
    await variant('scarce', 5000, 2);
    await variant('freebie', 0, 5);
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
    const [promo] = await t.db.insert(promotions).values({ name: 'Welcome', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 20000 }, status: 'active' }).returning();
    await t.db.insert(promotionCodes).values({ promotionId: promo!.id, code: 'WELCOME' });
  });

  beforeEach(() => {
    provider.reset();
  });

  after(async () => {
    await server?.stop();
    await t?.destroy();
  });

  it('creates a pending order, reservation and payment attempt, then initializes Paystack', async () => {
    const before = await stock(v.wig!);
    const { status, body, headers } = await submit(base({ promotionCodes: ['welcome'] }));
    assert.equal(status, 201);
    assert.match(body.orderNumber, /^JH-\d{8}-0001$/);
    assert.equal(body.provider, 'paystack');
    assert.equal(body.accessCode, 'ac_test');
    assert.equal(body.amountMinor, 100000 - 20000 + 150000);
    assert.equal(body.currency, 'NGN');
    assert.ok(new Date(body.reservationExpiresAt) > new Date());
    assert.equal(headers['cache-control'], 'no-store');

    const cookie = String(headers['set-cookie']);
    assert.match(cookie, /jh_checkout=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Lax/i);

    const [order] = await t.db.select().from(orders).where(eq(orders.id, body.orderId));
    assert.equal(order!.status, 'pending_payment');
    assert.equal(order!.paymentStatus, 'pending');
    assert.equal(order!.email, 'buyer@example.com');
    assert.equal(order!.totalMinor, body.amountMinor);
    assert.ok(order!.guestCheckoutTokenHash);
    assert.ok(!cookie.includes(order!.guestCheckoutTokenHash!), 'only the hash is stored');

    const items = await t.db.select().from(orderItems).where(eq(orderItems.orderId, order!.id));
    assert.equal(items[0]!.titleSnapshot, 'Title wig');
    assert.deepEqual(items[0]!.optionsSnapshot, { length: '20in' });
    assert.equal(items[0]!.discountMinor, 20000);

    const reservations = await t.db.select().from(stockReservations).where(eq(stockReservations.orderId, order!.id));
    assert.equal(reservations.length, 1);
    assert.equal((await stock(v.wig!)).reservedQuantity, before.reservedQuantity + 1);

    const [attempt] = await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order!.id));
    assert.equal(attempt!.status, 'pending');
    assert.equal(attempt!.amountMinor, body.amountMinor);
    assert.equal(attempt!.providerReference, body.reference);

    // Promotions are snapshotted on the order but not claimed until payment is confirmed.
    const applied = order!.appliedPromotions as Json[];
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.code, 'WELCOME');
    assert.equal(applied[0]!.discountMinor, 20000);
    const [promo] = await t.db.select().from(promotions).where(eq(promotions.id, applied[0]!.promotionId));
    assert.equal(promo!.usageCount, 0);
    assert.equal((await t.db.select().from(promotionRedemptions)).length, 0);

    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0]!.amountMinor, body.amountMinor);
    assert.equal(provider.calls[0]!.email, 'buyer@example.com');
    assert.deepEqual(provider.calls[0]!.channels, ['card']);
    assert.equal(provider.calls[0]!.callbackUrl, 'https://shop.test/pay/return');
    assert.deepEqual(provider.calls[0]!.metadata, { orderId: order!.id, paymentAttemptId: attempt!.id });
  });

  it('replays the original response for the same key and payload without a second order', async () => {
    const first = await submit(base());
    const again = await submit(base(), first.key);
    assert.equal(again.status, 201);
    assert.equal(again.body.orderId, first.body.orderId);
    assert.equal(again.body.reference, first.body.reference);
    assert.equal(provider.calls.length, 1);
    assert.equal((await t.db.select().from(orders).where(eq(orders.id, first.body.orderId))).length, 1);
  });

  it('rejects the same key with a different payload', async () => {
    const first = await submit(base());
    const again = await submit(base({ items: [{ variantId: v.wig, quantity: 2 }] }), first.key);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('creates exactly one order for concurrent submissions with one key', async () => {
    const key = 'concurrent-key-0001-abcdef-0123456789abcdefghijklmnopqrstuv';
    const results = await Promise.all(Array.from({ length: 5 }, () => submit(base(), key)));
    const created = results.filter((r) => r.status === 201);
    assert.ok(created.length >= 1);
    assert.equal(new Set(created.map((r) => r.body.orderId)).size, 1);
    assert.ok(results.every((r) => r.status === 201 || r.body.error.code === 'IDEMPOTENCY_IN_PROGRESS'));
    assert.equal((await t.db.select().from(orders).where(eq(orders.id, created[0]!.body.orderId))).length, 1);
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const missing = await server.inject({ method: 'POST', url: '/api/v1/checkout', payload: base() });
    assert.equal(missing.statusCode, 422);
    const short = await server.inject({ method: 'POST', url: '/api/v1/checkout', payload: base(), headers: { 'idempotency-key': 'abc' } });
    assert.equal(short.statusCode, 422);
  });

  it('ignores client-asserted prices, totals and references', async () => {
    for (const extra of [{ totalMinor: 1 }, { reference: 'mine' }, { quoteId: 'x' }, { paymentStatus: 'paid' }]) {
      assert.equal((await submit(base(extra))).status, 422);
    }
    const priced = await submit(base({ items: [{ variantId: v.wig, quantity: 1, unitPriceMinor: 1 }] }));
    assert.equal(priced.status, 422);
  });

  it('validates contact, address, terms and payment method', async () => {
    assert.equal((await submit(base({ contact: { email: 'nope', phone: '+2348012345678' } }))).status, 422);
    assert.equal((await submit(base({ contact: { email: 'a@b.co', phone: '08012345678' } }))).status, 422);
    assert.equal((await submit(base({ termsAccepted: false }))).status, 422);
    assert.equal((await submit(base({ paymentMethod: 'ussd' }))).status, 422);
    assert.equal((await submit(base({ deliveryAddress: { ...address, recipientName: undefined } }))).status, 422);
  });

  it('returns 409 OUT_OF_STOCK, and leaves no order, reservation or key behind', async () => {
    const before = await stock(v.scarce!);
    const key = 'oos-key-00000001-abcdef-0123456789abcdefghijklmnopqrstuv';
    const res = await submit(base({ items: [{ variantId: v.scarce, quantity: 3 }] }), key);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'OUT_OF_STOCK');
    assert.equal(res.body.error.details[0].variantId, v.scarce);
    assert.equal((await stock(v.scarce!)).reservedQuantity, before.reservedQuantity);
    assert.equal((await t.db.select().from(orderItems).where(eq(orderItems.variantId, v.scarce!))).length, 0);
    assert.equal(provider.calls.length, 0);
    assert.equal((await t.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key))).length, 0);
  });

  it('rolls back every line when one of several is short', async () => {
    const wigBefore = await stock(v.wig!);
    const res = await submit(base({ items: [{ variantId: v.wig, quantity: 1 }, { variantId: v.scarce, quantity: 99 }] }));
    assert.equal(res.status, 409);
    assert.equal((await stock(v.wig!)).reservedQuantity, wigBefore.reservedQuantity);
  });

  it('rejects unavailable variants and undeliverable destinations without creating orders', async () => {
    const ghost = await submit(base({ items: [{ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] }));
    assert.equal(ghost.status, 422);
    assert.equal(ghost.body.error.code, 'VARIANT_UNAVAILABLE');
    const abroad = await submit(base({ deliveryAddress: { ...address, state: 'Oyo', area: undefined } }));
    assert.equal(abroad.status, 422);
    assert.equal(abroad.body.error.code, 'DELIVERY_UNAVAILABLE');
    const method = await submit(base({ deliveryMethod: 'same_day' }));
    assert.equal(method.body.error.code, 'DELIVERY_METHOD_UNAVAILABLE');
  });

  it('refuses a zero-value order', async () => {
    const res = await submit(base({ items: [{ variantId: v.freebie, quantity: 1 }], deliveryMethod: 'pickup' }));
    assert.equal(res.status, 422);
  });

  it('marks the attempt failed on a definitive provider rejection and keeps the order retryable', async () => {
    provider.initializeMode = 'reject';
    const res = await submit(base());
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'PAYMENT_INITIALIZATION_FAILED');
    assert.ok(res.body.error.requestId);
    const orderId = res.body.error.details[0].orderId;
    const [attempt] = await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId));
    assert.equal(attempt!.status, 'failed');
    const [order] = await t.db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(order!.status, 'pending_payment');
    assert.equal((await t.db.select().from(stockReservations).where(eq(stockReservations.orderId, orderId)))[0]!.releasedAt, null);
    assert.match(String(res.headers['set-cookie']), /jh_checkout=/);

    const replay = await submit(base(), res.key);
    assert.equal(replay.status, 502);
    assert.equal(provider.calls.length, 1);
  });

  it('keeps the attempt initializing when the provider outcome is unknown', async () => {
    provider.initializeMode = 'timeout';
    const res = await submit(base());
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'PAYMENT_INITIALIZATION_PENDING');
    const [attempt] = await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, res.body.error.details[0].orderId));
    assert.equal(attempt!.status, 'initializing');
  });

  it('issues sequential order numbers', async () => {
    const a = await submit(base());
    const b = await submit(base());
    assert.equal(Number(b.body.orderNumber.slice(-4)) - Number(a.body.orderNumber.slice(-4)), 1);
  });

  it('is unavailable (503) when no payment provider is configured', async () => {
    const bare = await createServer({ env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' }), logger: createLogger('error'), database: t });
    await bare.initialize();
    const res = await bare.inject({ method: 'POST', url: '/api/v1/checkout', payload: base(), headers: { 'idempotency-key': 'nopay-key-0000001-abcd-0123456789abcdefghijklmnopqrstuv' } });
    assert.equal(res.statusCode, 503);
    assert.equal((res.result as Json).error.code, 'PAYMENTS_UNAVAILABLE');
    await bare.stop();
  });
});

describe('PaystackProvider', () => {
  const input: InitializeInput = { email: 'a@b.co', amountMinor: 5000, currency: 'NGN', reference: 'jh_ref', channels: ['card'], metadata: { orderId: 'o' } };
  const provider = (fetchImpl: typeof fetch) => new PaystackProvider({ secretKey: 'sk_test_secret', baseUrl: 'https://paystack.test', fetch: fetchImpl });
  const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('sends amount in kobo with the secret key and parses the response', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const p = provider((async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ status: true, data: { reference: 'jh_ref', access_code: 'ac', authorization_url: 'https://c/x' } }), { status: 200 });
    }) as unknown as typeof fetch);
    const out = await p.initialize(input);
    assert.deepEqual(out, { reference: 'jh_ref', accessCode: 'ac', authorizationUrl: 'https://c/x' });
    assert.equal(seen!.url, 'https://paystack.test/transaction/initialize');
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer sk_test_secret');
    const sent = JSON.parse(String(seen!.init.body));
    assert.equal(sent.amount, 5000);
    assert.equal(sent.reference, 'jh_ref');
  });

  it('treats 4xx as a definitive rejection and 5xx, 429 or network errors as indeterminate', async () => {
    await assert.rejects(provider(json(400, { status: false }) as unknown as typeof fetch).initialize(input), PaymentRejectedError);
    await assert.rejects(provider(json(503, {}) as unknown as typeof fetch).initialize(input), PaymentIndeterminateError);
    await assert.rejects(provider(json(429, {}) as unknown as typeof fetch).initialize(input), PaymentIndeterminateError);
    await assert.rejects(provider((async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch).initialize(input), PaymentIndeterminateError);
    await assert.rejects(provider(json(200, { status: true, data: {} }) as unknown as typeof fetch).initialize(input), PaymentIndeterminateError);
  });
});
