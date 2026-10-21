import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { contentEntries, deliveryZones, inventory, orderItems, orders, paymentAttempts, productVariants, products, reviews } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeProvider } from '../../testing/fake-provider.js';

type Json = Record<string, any>;
const AUTH_SECRET = 'test-auth-secret-0123456789-abcdefghij';

describe('storefront content, suggestions, reviews and bank transfer', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  const ids: Record<string, string> = {};
  let phones = 0;
  let n = 0;

  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await api.inject({ url: `/api/v1${url}`, headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const signup = async () => {
    const phone = `+23482${String(30_000_000 + ++phones)}`;
    const res = await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: `${phone.slice(1)}@example.com`, phone, password: 'correct horse battery' } });
    return { phone, token: (res.result as Json).accessToken as string, id: (res.result as Json).customer.id as string };
  };
  const addProduct = async (slug: string, title: string, over: Partial<typeof products.$inferInsert> = {}) => {
    const [p] = await t.db.insert(products).values({ slug, title, status: 'active', publishedAt: new Date('2026-01-01'), ...over }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: `sku-${slug}`, optionSignature: { n: slug }, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 50 });
    ids[slug] = p!.id;
    ids[`v:${slug}`] = v!.id;
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({
      env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', AUTH_TOKEN_SECRET: AUTH_SECRET }),
      logger: createLogger('error'),
      database: t,
      payments: provider,
    });
    await api.initialize();
    await addProduct('silky-bob', 'Silky Straight Bob');
    await addProduct('body-wave', 'Body Wave Frontal', { featured: true });
    await addProduct('hidden-draft', 'Silky Draft', { status: 'draft' });
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('homepage and pages', () => {
    it('returns only published, in-window content in order, with the curated featured row', async () => {
      const day = 86_400_000;
      await t.db.insert(contentEntries).values([
        { contentType: 'announcement', slug: 'a-live', title: 'live', body: { text: 'Free delivery' }, status: 'published', sortOrder: 1 },
        { contentType: 'announcement', slug: 'a-draft', title: 'draft', body: { text: 'Draft' }, status: 'draft' },
        { contentType: 'announcement', slug: 'a-future', title: 'future', body: { text: 'Soon' }, status: 'published', startsAt: new Date(Date.now() + day) },
        { contentType: 'announcement', slug: 'a-ended', title: 'ended', body: { text: 'Gone' }, status: 'published', endsAt: new Date(Date.now() - day) },
        { contentType: 'banner', slug: 'b1', title: 'b1', body: { headline: 'New in' }, status: 'published' },
        { contentType: 'featured_products', slug: 'row', title: 'row', body: { heading: 'Picks', productIds: [ids['silky-bob'], ids['hidden-draft'], ids['body-wave']] }, status: 'published' },
      ]);
      const { status, body } = await get('/storefront/home');
      assert.equal(status, 200);
      assert.deepEqual(body.data.announcements.map((a: Json) => a.text), ['Free delivery']);
      const section = (type: string) => body.data.sections.find((x: Json) => x.type === type);
      assert.equal(section('hero').cards[0].headline, 'New in');
      assert.equal(section('products').title, 'Picks');
      const featured = section('products').tabs.find((t: Json) => t.key === 'featured');
      assert.deepEqual(featured.products.map((p: Json) => p.slug), ['silky-bob', 'body-wave'], 'curated order; the draft drops out');
    });

    it('serves a published page by slug and hides drafts', async () => {
      await t.db.insert(contentEntries).values([
        { contentType: 'page', slug: 'returns', title: 'Returns', body: { markdown: '# Returns' }, status: 'published' },
        { contentType: 'page', slug: 'secret', title: 'Secret', body: { markdown: 'x' }, status: 'draft' },
      ]);
      const ok = await get('/content/pages/returns');
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.markdown, '# Returns');
      assert.equal((await get('/content/pages/secret')).status, 404);
      assert.equal((await get('/content/pages/nope')).status, 404);
    });
  });

  describe('suggestions', () => {
    it('matches word prefixes on visible products only', async () => {
      const res = await get('/products/suggestions?q=silk');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((s: Json) => s.slug), ['silky-bob']);
      assert.deepEqual((await get('/products/suggestions?q=front')).body.data.map((s: Json) => s.slug), ['body-wave']);
      assert.equal((await get('/products/suggestions?q=s')).status, 422, 'too short');
      assert.deepEqual((await get('/products/suggestions?q=%25%25')).body.data, [], 'LIKE wildcards are escaped');
    });
  });

  describe('reviews', () => {
    const orderWithItem = async (customerId: string, over: Partial<typeof orders.$inferInsert> = {}) => {
      const [o] = await t.db
        .insert(orders)
        .values({
          orderNumber: `JH-T-${++n}`, customerId, phoneE164: '+2348000000000', subtotalMinor: 100000, totalMinor: 100000,
          deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date(), status: 'delivered', paymentStatus: 'paid', ...over,
        })
        .returning();
      const [item] = await t.db
        .insert(orderItems)
        .values({ orderId: o!.id, productId: ids['silky-bob']!, variantId: ids['v:silky-bob']!, skuSnapshot: 's', titleSnapshot: 't', optionsSnapshot: { length: '20' }, quantity: 1, unitPriceMinor: 100000, lineTotalMinor: 100000 })
        .returning();
      return item!.id;
    };
    const post = (token: string | null, payload: Json) =>
      api.inject({ method: 'POST', url: '/api/v1/reviews', payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

    it('requires sign-in, a delivered paid order of your own, and only once per item', async () => {
      const alice = await signup();
      const bob = await signup();
      const item = await orderWithItem(alice.id);

      assert.equal((await post(null, { orderItemId: item, rating: 5 })).statusCode, 401);
      assert.equal((await post(bob.token, { orderItemId: item, rating: 5 })).statusCode, 404, "someone else's item");

      const undelivered = await orderWithItem(alice.id, { status: 'packed' });
      const early = await post(alice.token, { orderItemId: undelivered, rating: 5 });
      assert.equal(early.statusCode, 422);
      assert.equal((early.result as Json).error.code, 'REVIEW_NOT_ELIGIBLE');

      const created = await post(alice.token, { orderItemId: item, rating: 5, title: 'Lovely', body: 'Melts into the skin', location: 'Lagos' });
      assert.equal(created.statusCode, 201);
      assert.equal((created.result as Json).status, 'pending');
      const again = await post(alice.token, { orderItemId: item, rating: 4 });
      assert.equal(again.statusCode, 409);
      assert.equal((again.result as Json).error.code, 'REVIEW_EXISTS');
      assert.equal((await post(alice.token, { orderItemId: item, rating: 9 })).statusCode, 422);
    });

    it('lists only approved reviews with a summary and paginates by sort', async () => {
      const customers = [await signup(), await signup(), await signup()];
      const rows = [5, 4, 1];
      for (const [i, c] of customers.entries()) {
        const item = await orderWithItem(c.id);
        const [r] = await t.db.insert(reviews).values({ productId: ids['silky-bob']!, customerId: c.id, orderItemId: item, rating: rows[i]!, title: `r${rows[i]}`, status: 'approved', verifiedBuyer: true }).returning();
        await t.db.update(reviews).set({ createdAt: new Date(Date.UTC(2026, 5, 10 + i)) }).where(eq(reviews.id, r!.id));
      }
      const pending = await signup();
      await t.db.insert(reviews).values({ productId: ids['silky-bob']!, customerId: pending.id, rating: 2, status: 'pending' });

      const first = await get(`/products/${ids['silky-bob']}/reviews?sort=highest&limit=2`);
      assert.equal(first.status, 200);
      const approvedFromEarlierTest = first.body.summary.count - 3;
      assert.ok(approvedFromEarlierTest >= 0);
      assert.deepEqual(first.body.data.map((r: Json) => r.rating), [5, 4]);
      assert.ok(first.body.page.nextCursor);
      const second = await get(`/products/${ids['silky-bob']}/reviews?sort=highest&limit=2&cursor=${first.body.page.nextCursor}`);
      assert.deepEqual(second.body.data.map((r: Json) => r.rating), [1]);
      assert.equal(second.body.page.nextCursor, null);
      assert.equal(first.body.summary.breakdown['2'], 0, 'pending reviews do not count');
      assert.equal(first.body.summary.count, 3);
      assert.equal(first.body.summary.average, 3.33);
      assert.equal((await get(`/products/${ids['silky-bob']}/reviews?rating=4`)).body.data.length, 1);
      assert.equal((await get(`/products/${ids['hidden-draft']}/reviews`)).status, 404);
    });
  });

  describe('bank transfer', () => {
    it('initializes Paystack on the bank_transfer channel, holds stock for the configured transfer window, and keeps the method on retry', async () => {
      provider.reset();
      const phone = `+23483${String(40_000_000 + ++phones)}`;
      const payload = {
        items: [{ variantId: ids['v:body-wave'], quantity: 1 }],
        promotionCodes: [],
        contact: { phone },
        deliveryAddress: { recipientName: 'Buyer', addressLine1: '1 Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' },
        deliveryMethod: 'next_day',
        paymentMethod: 'bank_transfer',
        termsAccepted: true,
      };
      const res = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload, headers: { 'idempotency-key': `transfer-key-${++n}-abcdefghijkl-0123456789abcdefghijklmnopqrstuv` } });
      assert.equal(res.statusCode, 201, JSON.stringify(res.result));
      assert.deepEqual(provider.calls.at(-1)!.channels, ['bank_transfer']);
      const body = res.result as Json;
      const [attempt] = await t.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, body.orderId));
      assert.equal(attempt!.method, 'bank_transfer');
      const ttlMinutes = (new Date(body.reservationExpiresAt).getTime() - Date.now()) / 60_000;
      assert.ok(ttlMinutes > 40 && ttlMinutes <= 45, `default transfer hold is 45 minutes, got ${ttlMinutes}`);

      // A definitively failed attempt is retried on the same channel.
      await t.db.update(paymentAttempts).set({ status: 'failed' }).where(eq(paymentAttempts.id, attempt!.id));
      const retry = await api.inject({
        method: 'POST',
        url: `/api/v1/checkout/${body.orderId}/payment-attempts`,
        headers: { 'idempotency-key': `transfer-retry-${++n}-abcdefghijkl`, cookie: `jh_checkout=${/jh_checkout=([^;]+)/.exec(String(res.headers['set-cookie']))![1]}` },
      });
      assert.equal(retry.statusCode, 201, JSON.stringify(retry.result));
      assert.deepEqual(provider.calls.at(-1)!.channels, ['bank_transfer']);
    });
  });
});
