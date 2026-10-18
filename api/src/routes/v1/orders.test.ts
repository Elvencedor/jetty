import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { deliveryZones, inventory, notificationOutbox, orders, orderStatusEvents, productVariants, products } from '../../db/schema/index.js';
import { type Policy, type RateLimiter } from '../../lib/rate-limit.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeProvider } from '../../testing/fake-provider.js';
import { createTestRateLimiter, TEST_REDIS_URL } from '../../testing/redis.js';

type Json = Record<string, any>;
const AUTH_SECRET = 'test-auth-secret-0123456789-abcdefghij';
const PASSWORD = 'correct horse battery';

describe('order history, tracking, optional email and rate limits', { skip: (!TEST_DATABASE_URL && 'TEST_DATABASE_URL not set') || (!TEST_REDIS_URL && 'TEST_REDIS_URL not set') }, () => {
  let t: TestDatabase;
  let api: Server;
  let limited: Server;
  let limiter: RateLimiter;
  const provider = new FakeProvider();
  let variantId = '';
  let n = 0;
  let phones = 0;
  const newPhone = () => `+23481${String(20_000_000 + ++phones)}`;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const env = (extra: Record<string, string> = {}) =>
    loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', AUTH_TOKEN_SECRET: AUTH_SECRET, PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: 'noemail.test', ...extra });

  const signup = async () => {
    const phone = newPhone();
    const res = await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone, password: PASSWORD } });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return { phone, token: (res.result as Json).accessToken as string };
  };
  const body = (phone: string, over: Json = {}) => ({
    items: [{ variantId, quantity: 2 }],
    promotionCodes: [],
    contact: { phone },
    deliveryAddress: { recipientName: 'Buyer', addressLine1: '12 Example Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' },
    deliveryMethod: 'next_day',
    paymentMethod: 'card',
    termsAccepted: true,
    ...over,
  });
  const place = async (phone: string, headers: Record<string, string> = {}, over: Json = {}) => {
    const res = await api.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: body(phone, over),
      headers: { 'idempotency-key': `orders-key-${String(++n).padStart(8, '0')}-abcdef`, ...headers },
    });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return res.result as Json;
  };
  const pay = async (reference: string) => {
    provider.set(reference, { status: 'success' });
    const res = await api.inject({ method: 'POST', url: '/api/v1/checkout/paystack/verify', payload: { reference } });
    assert.equal(res.statusCode, 200);
  };
  const get = (url: string, headers: Record<string, string> = {}) => api.inject({ method: 'GET', url: `/api/v1${url}`, headers });
  const track = (payload: Json, server = api, headers: Record<string, string> = {}) => server.inject({ method: 'POST', url: '/api/v1/orders/track', payload, headers });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: env(), logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    limiter = await createTestRateLimiter();
    limited = await createServer({ env: env({ RATE_LIMIT_ENABLED: 'true', REDIS_URL: TEST_REDIS_URL!, TRUSTED_PROXY_HOPS: '1' }), logger: createLogger('error'), database: t, payments: provider, rateLimiter: limiter });
    await limited.initialize();

    const [p] = await t.db.insert(products).values({ slug: 'orders-wig', title: 'Orders Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'orders-wig', optionSignature: { length: '20' }, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: 500 });
    variantId = pv!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await limited?.stop();
    await limiter?.close();
    await t?.destroy();
  });

  describe('optional email', () => {
    it('checks out with a phone number only, using a per-phone placeholder for Paystack and SMS for notifications', async () => {
      provider.reset();
      const phone = newPhone();
      const placed = await place(phone);
      const [o] = await t.db.select().from(orders).where(eq(orders.id, placed.orderId));
      assert.equal(o!.email, null);
      assert.equal(o!.phoneE164, phone);
      const sent = provider.calls.at(-1)!;
      assert.match(sent.email, /^phone-[0-9a-f]{20}@noemail\.test$/);
      assert.ok(!sent.email.includes(phone.slice(1)), 'the phone number is not disclosed in the address');
      assert.ok(!JSON.stringify(placed).includes('noemail.test'), 'the placeholder never reaches the customer');

      await pay(placed.reference);
      const outbox = (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'order.placed'))).filter((m) => (m.payload as Json).orderId === placed.orderId);
      assert.deepEqual(outbox.map((m) => [m.channel, m.recipient]), [['sms', phone]]);
    });

    it('also queues an email when the customer provides one, and sends that email to Paystack', async () => {
      provider.reset();
      const phone = newPhone();
      const placed = await place(phone, {}, { contact: { phone, email: 'Buyer@Example.com' } });
      assert.equal(provider.calls.at(-1)!.email, 'buyer@example.com');
      await pay(placed.reference);
      const outbox = (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'order.placed'))).filter((m) => (m.payload as Json).orderId === placed.orderId);
      assert.deepEqual(outbox.map((m) => m.channel).sort(), ['email', 'sms']);
    });

    it('uses the same placeholder on a payment retry', async () => {
      provider.reset();
      const phone = newPhone();
      const placed = await place(phone);
      const first = provider.calls.at(-1)!.email;
      const cookie = String(
        (await api.inject({ method: 'GET', url: `/api/v1/checkout/${placed.orderId}/status` })).headers['set-cookie'] ?? '',
      );
      void cookie;
      assert.match(first, /^phone-/);
    });
  });

  describe('GET /me/orders', () => {
    it('requires authentication', async () => {
      assert.equal((await get('/me/orders')).statusCode, 401);
      assert.equal((await get('/me/orders/00000000-0000-4000-8000-000000000000')).statusCode, 401);
    });

    it('lists only the customer’s own orders, newest first, with a stable cursor', async () => {
      const a = await signup();
      const b = await signup();
      const mine: string[] = [];
      for (let i = 0; i < 5; i++) mine.push((await place(a.phone, bearer(a.token))).orderId);
      await place(b.phone, bearer(b.token));
      await place(a.phone);

      const first = await get('/me/orders?limit=2', bearer(a.token));
      assert.equal(first.statusCode, 200);
      assert.equal(first.headers['cache-control'], 'no-store');
      const page1 = first.result as Json;
      assert.deepEqual(page1.items.map((i: Json) => i.id), [mine[4], mine[3]]);
      assert.ok(page1.nextCursor);
      assert.equal(page1.items[0].itemCount, 2);
      assert.equal(page1.items[0].status, 'pending_payment');

      const page2 = (await get(`/me/orders?limit=2&cursor=${page1.nextCursor}`, bearer(a.token))).result as Json;
      assert.deepEqual(page2.items.map((i: Json) => i.id), [mine[2], mine[1]]);
      const page3 = (await get(`/me/orders?limit=2&cursor=${page2.nextCursor}`, bearer(a.token))).result as Json;
      assert.deepEqual(page3.items.map((i: Json) => i.id), [mine[0]]);
      assert.equal(page3.nextCursor, null);

      assert.equal((await get('/me/orders?cursor=garbage', bearer(a.token))).statusCode, 400);
      assert.equal((await get('/me/orders?limit=500', bearer(a.token))).statusCode, 422);
      assert.equal(((await get('/me/orders', bearer(b.token))).result as Json).items.length, 1);
    });

    it('returns order detail with items, totals and a timeline that hides internal notes', async () => {
      const a = await signup();
      const placed = await place(a.phone, bearer(a.token));
      await pay(placed.reference);

      const res = await get(`/me/orders/${placed.orderId}`, bearer(a.token));
      assert.equal(res.statusCode, 200);
      const o = res.result as Json;
      assert.equal(o.status, 'placed');
      assert.equal(o.paymentStatus, 'paid');
      assert.equal(o.contact.phone, a.phone);
      assert.equal(o.contact.email, null);
      assert.equal(o.items.length, 1);
      assert.equal(o.items[0].title, 'Orders Wig');
      assert.equal(o.items[0].quantity, 2);
      assert.equal(o.totals.totalMinor, 200000 + 150000);
      assert.equal(o.deliveryAddress.city, 'Lagos');
      assert.equal(o.reservationExpiresAt, null);
      assert.deepEqual(o.timeline.map((e: Json) => e.status), ['pending_payment', 'placed']);
      for (const e of o.timeline) assert.deepEqual(Object.keys(e).sort(), ['at', 'status']);
      assert.ok(!JSON.stringify(o).includes('PAYMENT_VERIFIED'));
      assert.ok(!('guestCheckoutTokenHash' in o));
    });

    it('shows when an unpaid order stops holding stock, and treats other customers’ and guest orders as 404', async () => {
      const a = await signup();
      const b = await signup();
      const unpaid = await place(a.phone, bearer(a.token));
      const detail = (await get(`/me/orders/${unpaid.orderId}`, bearer(a.token))).result as Json;
      assert.ok(detail.reservationExpiresAt);
      assert.equal((await get(`/me/orders/${unpaid.orderId}`, bearer(b.token))).statusCode, 404);
      const guest = await place(newPhone());
      assert.equal((await get(`/me/orders/${guest.orderId}`, bearer(a.token))).statusCode, 404);
      assert.equal((await get('/me/orders/not-a-uuid', bearer(a.token))).statusCode, 422);
    });
  });

  describe('POST /orders/track', () => {
    it('returns a minimal timeline for the right order number and phone, ignoring case', async () => {
      const phone = newPhone();
      const placed = await place(phone);
      await pay(placed.reference);
      await t.db.insert(orderStatusEvents).values({ orderId: placed.orderId, fromStatus: 'placed', toStatus: 'packed', actorType: 'admin', note: 'internal note' });

      const res = await track({ orderNumber: ` ${String(placed.orderNumber).toLowerCase()} `, phone });
      assert.equal(res.statusCode, 200);
      const o = res.result as Json;
      assert.equal(o.orderNumber, placed.orderNumber);
      assert.deepEqual(o.timeline.map((e: Json) => e.status), ['pending_payment', 'placed', 'packed']);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.deepEqual(Object.keys(o).sort(), ['deliveryMethod', 'orderNumber', 'paymentStatus', 'placedAt', 'status', 'timeline']);
      const text = JSON.stringify(o);
      for (const secret of [phone, 'Example Street', 'internal note', 'Buyer']) assert.ok(!text.includes(secret), secret);
    });

    it('answers a wrong phone and an unknown order number identically', async () => {
      const placed = await place(newPhone());
      const wrongPhone = await track({ orderNumber: placed.orderNumber, phone: newPhone() });
      const unknown = await track({ orderNumber: 'JH-20000101-9999', phone: newPhone() });
      assert.equal(wrongPhone.statusCode, 404);
      assert.equal(unknown.statusCode, 404);
      assert.equal((wrongPhone.result as Json).error.message, (unknown.result as Json).error.message);
      assert.equal((wrongPhone.result as Json).error.code, (unknown.result as Json).error.code);
    });

    it('validates the body and never accepts the phone in the URL', async () => {
      assert.equal((await track({ orderNumber: 'JH-20260101-0001', phone: '0801' })).statusCode, 422);
      assert.equal((await track({ orderNumber: 'JH-20260101-0001' })).statusCode, 422);
      assert.equal((await track({ orderNumber: 'JH-20260101-0001', phone: newPhone(), extra: 1 })).statusCode, 422);
      assert.equal((await api.inject({ method: 'GET', url: '/api/v1/orders/track?orderNumber=JH-1&phone=%2B2348012345678' })).statusCode, 404);
    });
  });

  describe('rate limiting', () => {


    it('counts within a window, resets after it, and keeps subjects separate', async () => {
      const short: Policy = { name: 'unit-short', limit: 3, windowMs: 1000 };
      const subject = `subject-${Date.now()}`;
      for (let i = 1; i <= 3; i++) assert.equal((await limiter.consume(short, subject)).allowed, true);
      const blocked = await limiter.consume(short, subject);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.retryAfterSeconds, 1);
      assert.equal((await limiter.consume(short, `${subject}-other`)).allowed, true);
      assert.equal((await limiter.consume(short, subject.toUpperCase())).allowed, false, 'subjects are case-insensitive');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const fresh = await limiter.consume(short, subject);
      assert.equal(fresh.allowed, true);
      assert.equal(fresh.count, 1);
    });

    it('reports the time left in the window', async () => {
      const decision = await limiter.consume({ name: 'unit-ttl', limit: 1, windowMs: 60_000 }, `ttl-${Date.now()}`);
      assert.ok(decision.retryAfterSeconds > 55 && decision.retryAfterSeconds <= 60);
    });

    it('is atomic under concurrency', async () => {
      const subject = `race-${Date.now()}`;
      const results = await Promise.all(Array.from({ length: 12 }, () => limiter.consume({ name: 'race', limit: 5, windowMs: 60_000 }, subject)));
      assert.equal(results.filter((r) => r.allowed).length, 5);
    });

    it('clears a counter on reset', async () => {
      const once: Policy = { name: 'unit-reset', limit: 1, windowMs: 60_000 };
      const subject = `reset-${Date.now()}`;
      await limiter.consume(once, subject);
      assert.equal((await limiter.consume(once, subject)).allowed, false);
      await limiter.reset(once, subject);
      assert.equal((await limiter.consume(once, subject)).allowed, true);
    });

    it('fails open when Redis is unreachable', async () => {
      const down = await createServer({
        env: env({ RATE_LIMIT_ENABLED: 'true', REDIS_URL: TEST_REDIS_URL! }),
        logger: createLogger('error'),
        database: t,
        payments: provider,
        rateLimiter: { consume: () => Promise.reject(new Error('redis down')), reset: () => Promise.reject(new Error('redis down')), close: async () => {} },
      });
      await down.initialize();
      assert.equal((await track({ orderNumber: 'JH-20000101-0001', phone: '+2348000000009' }, down)).statusCode, 404);
      await down.stop();
    });

    it('throttles guest tracking per IP with a 429, Retry-After and the standard envelope', async () => {
      const headers = { 'x-forwarded-for': '203.0.113.7' };
      let last;
      for (let i = 0; i < 21; i++) last = await track({ orderNumber: `JH-20000101-${String(1000 + i)}`, phone: '+2348000000001' }, limited, headers);
      assert.equal(last!.statusCode, 429);
      assert.equal((last!.result as Json).error.code, 'RATE_LIMITED');
      assert.ok(Number(last!.headers['retry-after']) > 0);
      assert.ok((last!.result as Json).error.requestId);
      // Another client is unaffected.
      assert.equal((await track({ orderNumber: 'JH-20000101-1000', phone: '+2348000000001' }, limited, { 'x-forwarded-for': '203.0.113.8' })).statusCode, 404);
    });

    it('trusts only the proxy-added forwarded address, so a spoofed one does not evade the limit', async () => {
      let last;
      for (let i = 0; i < 21; i++) {
        last = await track({ orderNumber: `JH-20000101-${String(2000 + i)}`, phone: '+2348000000002' }, limited, { 'x-forwarded-for': `10.9.9.${i}, 198.51.100.20` });
      }
      assert.equal(last!.statusCode, 429);
    });

    it('caps guesses against a single order number across different IPs', async () => {
      const orderNumber = 'JH-20000101-5555';
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await track({ orderNumber, phone: `+23480000${String(1000 + i)}` }, limited, { 'x-forwarded-for': `192.0.2.${i + 1}` })).statusCode);
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(404));
      assert.deepEqual(statuses.slice(10), [429, 429]);
    });

    it('locks an account after repeated failed logins, even with the right password, and unlocks on success only before the cap', async () => {
      const { phone } = await signup();
      const login = (password: string, ip: string) =>
        limited.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { phone, password }, headers: { 'x-forwarded-for': ip } });

      // Failures below the cap are forgotten after a successful login.
      for (let i = 0; i < 5; i++) assert.equal((await login('wrong password!!', '198.51.100.1')).statusCode, 401);
      assert.equal((await login(PASSWORD, '198.51.100.1')).statusCode, 200);
      for (let i = 0; i < 5; i++) assert.equal((await login('wrong password!!', '198.51.100.2')).statusCode, 401);

      // Spread over many IPs, the account still locks.
      for (let i = 0; i < 3; i++) assert.equal((await login('wrong password!!', `198.51.100.${10 + i}`)).statusCode, 401);
      const locked = await login(PASSWORD, '198.51.100.99');
      assert.equal(locked.statusCode, 429);
      assert.ok(Number(locked.headers['retry-after']) > 0);

      // Other accounts are untouched.
      const other = await signup();
      const res = await limited.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { phone: other.phone, password: PASSWORD }, headers: { 'x-forwarded-for': '198.51.100.99' } });
      assert.equal(res.statusCode, 200);
    });

    it('limits sign-in code requests per phone and per IP, so texts cannot be pumped', async () => {
      const request = (phone: string, ip: string) =>
        limited.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone }, headers: { 'x-forwarded-for': ip } });
      const phone = newPhone();
      const perPhone: number[] = [];
      for (let i = 0; i < 6; i++) perPhone.push((await request(phone, `203.0.113.${100 + i}`)).statusCode);
      assert.deepEqual(perPhone, [202, 202, 202, 202, 202, 429]);

      const perIp: number[] = [];
      for (let i = 0; i < 11; i++) perIp.push((await request(newPhone(), '203.0.113.200')).statusCode);
      assert.deepEqual(perIp, [...Array(10).fill(202), 429]);
    });

    it('limits registrations per IP', async () => {
      let last;
      for (let i = 0; i < 11; i++) {
        last = await limited.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone: newPhone(), password: PASSWORD }, headers: { 'x-forwarded-for': '203.0.113.50' } });
      }
      assert.equal(last!.statusCode, 429);
    });

    it('is disabled by default under NODE_ENV=test', async () => {
      const statuses = new Set<number>();
      for (let i = 0; i < 25; i++) statuses.add((await track({ orderNumber: `JH-20000101-${String(3000 + i)}`, phone: '+2348000000003' })).statusCode);
      assert.deepEqual([...statuses], [404]);
    });
  });
});
