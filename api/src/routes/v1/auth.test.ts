import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { customerSessions, customers, deliveryZones, inventory, orders, productVariants, products, promotionCodes, promotions } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { signAccessToken } from '../../lib/tokens.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeProvider } from '../../testing/fake-provider.js';

type Json = Record<string, any>;
const AUTH_SECRET = 'test-auth-secret-0123456789-abcdefghij';

describe('customer auth', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let noAuth: Server;
  const provider = new FakeProvider();
  let variantId = '';
  let n = 0;

  const post = (url: string, payload?: Json, headers: Record<string, string> = {}, server = api) =>
    server.inject({ method: 'POST', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers });
  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]).find((c) => c.startsWith('jh_refresh='));
    return raw ? raw.split(';')[0]! : undefined;
  };
  let accounts = 0;
  const newEmail = () => `customer-${++accounts}@example.com`;
  const register = async (extra: Json = {}) => {
    const email = extra.email ?? newEmail();
    const res = await post('/auth/register', { password: 'correct horse battery', ...extra, email });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return { body: res.result as Json, cookie: cookieOf(res)!, email: email as string };
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const checkoutBody = (over: Json = {}) => ({
    items: [{ variantId, quantity: 1 }],
    promotionCodes: [],
    contact: { email: 'buyer@example.com', phone: '+2348012345678' },
    deliveryAddress: { recipientName: 'Buyer', addressLine1: '12 Example Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' },
    deliveryMethod: 'next_day',
    paymentMethod: 'card',
    termsAccepted: true,
    ...over,
  });
  const place = (headers: Record<string, string>, over: Json = {}) =>
    api.inject({ method: 'POST', url: '/api/v1/checkout', payload: checkoutBody(over), headers: { 'idempotency-key': `auth-key-${String(++n).padStart(8, '0')}-abcdef-0123456789abcdefghijklmnopqrstuv`, ...headers } });

  before(async () => {
    t = await createTestDatabase();
    const env = loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', AUTH_TOKEN_SECRET: AUTH_SECRET, CORS_ORIGINS: 'http://localhost:3000' });
    api = await createServer({ env, logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    noAuth = await createServer({ env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' }), logger: createLogger('error'), database: t });
    await noAuth.initialize();

    const [p] = await t.db.insert(products).values({ slug: 'auth-wig', title: 'Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'auth-wig', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: 100 });
    variantId = pv!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await noAuth?.stop();
    await t?.destroy();
  });

  it('registers with an email and password, returns a session and never exposes the password hash', async () => {
    const { body, email } = await register({ email: 'Ada@Example.com' });
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(body.customer.email, 'ada@example.com');
    assert.equal(body.customer.phone, null);
    assert.ok(!JSON.stringify(body).includes('password'));
    const [row] = await t.db.select().from(customers).where(eq(customers.email, email.toLowerCase()));
    assert.match(row!.passwordHash!, /^scrypt\$/);
    const dup = await post('/auth/register', { email: 'ADA@example.com', password: 'another long password' });
    assert.equal(dup.statusCode, 409);
    assert.equal((dup.result as Json).error.code, 'ACCOUNT_EXISTS');
  });

  it('stores an optional phone number, and rejects one already in use', async () => {
    const { body } = await register({ phone: '+2348055500001' });
    assert.equal(body.customer.phone, '+2348055500001');
    const dup = await post('/auth/register', { email: newEmail(), phone: '+2348055500001', password: 'correct horse battery' });
    assert.equal(dup.statusCode, 409);
  });

  it('validates registration input: email is required, phone is not', async () => {
    assert.equal((await post('/auth/register', { password: 'correct horse battery' })).statusCode, 422);
    assert.equal((await post('/auth/register', { phone: '+2348055500002', password: 'correct horse battery' })).statusCode, 422);
    assert.equal((await post('/auth/register', { email: 'not-an-email', password: 'correct horse battery' })).statusCode, 422);
    assert.equal((await post('/auth/register', { email: newEmail(), phone: '08012345678', password: 'correct horse battery' })).statusCode, 422);
    assert.equal((await post('/auth/register', { email: newEmail(), password: 'short' })).statusCode, 422);
  });

  it('sets a Secure, HttpOnly, SameSite=Strict refresh cookie scoped to /auth', async () => {
    const res = await post('/auth/register', { email: newEmail(), password: 'correct horse battery' });
    const raw = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]).find((c) => c.startsWith('jh_refresh='))!;
    for (const part of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/api/v1/auth']) assert.ok(raw.includes(part), raw);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(!('refreshToken' in (res.result as Json)));
  });

  it('logs in by email (case-insensitive) with generic failures, and no longer by phone', async () => {
    const { email } = await register({ email: 'login@example.com', phone: '+2348055500003' });
    assert.equal((await post('/auth/login', { email, password: 'correct horse battery' })).statusCode, 200);
    assert.equal((await post('/auth/login', { email: 'LOGIN@example.com', password: 'correct horse battery' })).statusCode, 200);

    const wrong = await post('/auth/login', { email, password: 'wrong password!!' });
    const unknown = await post('/auth/login', { email: newEmail(), password: 'wrong password!!' });
    assert.equal(wrong.statusCode, 401);
    assert.equal((wrong.result as Json).error.code, 'INVALID_CREDENTIALS');
    assert.equal(unknown.statusCode, 401);
    assert.equal((wrong.result as Json).error.message, (unknown.result as Json).error.message);

    assert.equal((await post('/auth/login', { password: 'correct horse battery' })).statusCode, 422, 'an email is required');
    assert.equal((await post('/auth/login', { phone: '+2348055500003', password: 'correct horse battery' })).statusCode, 422, 'phone sign-in is gone');

    await t.db.update(customers).set({ status: 'blocked' }).where(eq(customers.email, email));
    const blocked = await post('/auth/login', { email, password: 'correct horse battery' });
    assert.equal(blocked.statusCode, 401);
    assert.equal((blocked.result as Json).error.code, 'INVALID_CREDENTIALS');
  });

  it('GET /me requires a valid bearer token', async () => {
    const { body } = await register();
    const me = await api.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(body.accessToken) });
    assert.equal(me.statusCode, 200);
    assert.equal((me.result as Json).phone, body.customer.phone);
    assert.equal((await api.inject({ method: 'GET', url: '/api/v1/me' })).statusCode, 401);
    assert.equal((await api.inject({ method: 'GET', url: '/api/v1/me', headers: bearer('garbage.token.value') })).statusCode, 401);

    const forged = signAccessToken({ sub: body.customer.id, sid: '00000000-0000-0000-0000-000000000000', exp: Math.floor(Date.now() / 1000) + 600 }, AUTH_SECRET);
    assert.equal((await api.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(forged) })).statusCode, 401, 'unknown session');
    const wrongKey = signAccessToken({ sub: body.customer.id, sid: '00000000-0000-0000-0000-000000000000', exp: Math.floor(Date.now() / 1000) + 600 }, 'x'.repeat(40));
    assert.equal((await api.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(wrongKey) })).statusCode, 401);
    const expired = signAccessToken({ sub: body.customer.id, sid: '00000000-0000-0000-0000-000000000000', exp: Math.floor(Date.now() / 1000) - 5 }, AUTH_SECRET);
    assert.equal((await api.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(expired) })).statusCode, 401);
  });

  it('rotates the refresh token and revokes the session when an old one is replayed', async () => {
    const { cookie } = await register();
    const first = await post('/auth/refresh', undefined, { cookie });
    assert.equal(first.statusCode, 200);
    const rotated = cookieOf(first)!;
    assert.notEqual(rotated, cookie);

    const replay = await post('/auth/refresh', undefined, { cookie });
    assert.equal(replay.statusCode, 401);
    assert.equal((replay.result as Json).error.code, 'INVALID_REFRESH_TOKEN');
    // The replay burned the session, so even the rotated token is dead.
    assert.equal((await post('/auth/refresh', undefined, { cookie: rotated })).statusCode, 401);
    assert.equal((await post('/auth/refresh')).statusCode, 401);
    assert.equal((await post('/auth/refresh', undefined, { cookie: 'jh_refresh=not-a-token' })).statusCode, 401);
  });

  it('refuses refresh from a foreign origin', async () => {
    const { cookie } = await register();
    assert.equal((await post('/auth/refresh', undefined, { cookie, origin: 'https://evil.example' })).statusCode, 403);
    assert.equal((await post('/auth/refresh', undefined, { cookie, origin: 'http://localhost:3000' })).statusCode, 200);
  });

  it('logout revokes the session immediately', async () => {
    const { body, cookie } = await register();
    assert.equal((await post('/auth/logout', undefined, bearer(body.accessToken))).statusCode, 204);
    assert.equal((await api.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(body.accessToken) })).statusCode, 401);
    assert.equal((await post('/auth/refresh', undefined, { cookie })).statusCode, 401);
    const [session] = await t.db.select().from(customerSessions).where(eq(customerSessions.customerId, body.customer.id));
    assert.ok(session!.revokedAt);
    assert.ok(!session!.refreshTokenHash.includes('.'), 'only a hash is stored');
  });

  it('answers 503 when no signing secret is configured', async () => {
    const res = await post('/auth/login', { email: 'nobody@example.com', password: 'whatever it is' }, {}, noAuth);
    assert.equal(res.statusCode, 503);
    assert.equal((res.result as Json).error.code, 'AUTH_UNAVAILABLE');
  });

  describe('checkout as a customer', () => {
    it('attaches the order to the customer, issues no guest cookie, and lets only them read its status', async () => {
      const { body } = await register();
      const other = await register();
      const res = await place(bearer(body.accessToken));
      assert.equal(res.statusCode, 201, JSON.stringify(res.result));
      assert.ok(!res.headers['set-cookie'], 'no guest checkout cookie');
      const orderId = (res.result as Json).orderId as string;
      const [o] = await t.db.select().from(orders).where(eq(orders.id, orderId));
      assert.equal(o!.customerId, body.customer.id);
      assert.equal(o!.guestCheckoutTokenHash, null);

      const own = await api.inject({ method: 'GET', url: `/api/v1/checkout/${orderId}/status`, headers: bearer(body.accessToken) });
      assert.equal(own.statusCode, 200);
      assert.equal((await api.inject({ method: 'GET', url: `/api/v1/checkout/${orderId}/status`, headers: bearer(other.body.accessToken) })).statusCode, 404);
      assert.equal((await api.inject({ method: 'GET', url: `/api/v1/checkout/${orderId}/status` })).statusCode, 404);
    });

    it('rejects an invalid token instead of silently treating the shopper as a guest', async () => {
      const res = await place(bearer('bad.token.here'));
      assert.equal(res.statusCode, 401);
    });

    it('still serves guests without credentials', async () => {
      const res = await place({});
      assert.equal(res.statusCode, 201);
      assert.ok(res.headers['set-cookie']);
    });

    it('applies per-customer-limited promotions only to signed-in customers', async () => {
      const [promo] = await t.db.insert(promotions).values({ name: 'Once', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 10000 }, status: 'active', perCustomerLimit: 1 }).returning();
      await t.db.insert(promotionCodes).values({ promotionId: promo!.id, code: 'MEMBERONLY' });
      const { body } = await register();

      const guest = await place({}, { promotionCodes: ['MEMBERONLY'] });
      assert.equal((guest.result as Json).quote.discountMinor, 0);
      const member = await place(bearer(body.accessToken), { promotionCodes: ['MEMBERONLY'] });
      assert.equal((member.result as Json).quote.discountMinor, 10000);
      // Their unpaid order holds their one use.
      const again = await place(bearer(body.accessToken), { promotionCodes: ['MEMBERONLY'] });
      assert.equal((again.result as Json).quote.discountMinor, 0);
    });

    it('scopes idempotency keys per customer', async () => {
      const a = await register();
      const b = await register();
      const key = 'shared-key-0000000000000001-0123456789abcdefghijklmnopqrstuv';
      const first = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: checkoutBody(), headers: { 'idempotency-key': key, ...bearer(a.body.accessToken) } });
      const second = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: checkoutBody(), headers: { 'idempotency-key': key, ...bearer(b.body.accessToken) } });
      assert.equal(first.statusCode, 201);
      assert.equal(second.statusCode, 201);
      assert.notEqual((first.result as Json).orderId, (second.result as Json).orderId);
    });
  });
});
