import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq, sql } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { contentEntries, deliveryZones, inventory, productMedia, productVariants, products, promotionCodes, promotions } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { adminTestEnv, signInAdmin } from '../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeProvider } from '../../testing/fake-provider.js';
import { FakeStorage } from '../../testing/fake-storage.js';

type Json = Record<string, any>;
const KEY = (tag: string) => `${tag}-0123456789abcdefghijklmnopqrstuvwxyz`;

describe('review hardening', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  const provider = new FakeProvider();
  const storage = new FakeStorage();
  let variantId = '';
  let n = 0;

  const body = (phone: string, over: Json = {}) => ({
    items: [{ variantId, quantity: 1 }], promotionCodes: [], contact: { phone },
    deliveryAddress: { recipientName: 'B', addressLine1: '1 St', city: 'Lagos', state: 'Lagos', countryCode: 'NG' },
    deliveryMethod: 'next_day', paymentMethod: 'card', termsAccepted: true, ...over,
  });
  const checkout = (phone: string, key: string, over: Json = {}, headers: Record<string, string> = {}) =>
    api.inject({ method: 'POST', url: '/api/v1/checkout', payload: body(phone, over), headers: { 'idempotency-key': key, ...headers } });
  const cookieOf = (res: { headers: Record<string, unknown> }) => /jh_checkout=([^;]+)/.exec(String(res.headers['set-cookie']))?.[1];
  const phone = () => `+23486${String(70_000_000 + ++n)}`;

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider, storage });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    const [p] = await t.db.insert(products).values({ slug: 'hard-wig', title: 'Hardening Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'HD-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 500 });
    await t.db.insert(productMedia).values({ productId: p!.id, objectKey: `products/${p!.id}/cover.webp`, isCover: true });
    variantId = v!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('guest checkout', () => {
    it('needs a long random Idempotency-Key, because that key is what protects a replay', async () => {
      const res = await checkout(phone(), 'short-but-valid-key-123');
      assert.equal(res.statusCode, 422);
      assert.equal((res.result as Json).error.code, 'VALIDATION_FAILED');
      assert.equal((await checkout(phone(), KEY('ok'))).statusCode, 201);
    });

    it('hands the guest the same checkout cookie again when a request is replayed', async () => {
      const key = KEY('replay');
      const p = phone();
      const first = await checkout(p, key);
      const replay = await checkout(p, key);
      assert.equal(first.statusCode, 201);
      assert.deepEqual((replay.result as Json).orderId, (first.result as Json).orderId);
      assert.ok(cookieOf(first));
      assert.equal(cookieOf(replay), cookieOf(first), 'a retry after a lost response still lets the guest poll their order');
      const status = await api.inject({ url: `/api/v1/checkout/${(first.result as Json).orderId}/status`, headers: { cookie: `jh_checkout=${cookieOf(replay)}` } });
      assert.equal(status.statusCode, 200);
    });

    it('does not let another guest read the order without that cookie', async () => {
      const first = await checkout(phone(), KEY('private'));
      const other = await checkout(phone(), KEY('other'));
      const stolen = await api.inject({ url: `/api/v1/checkout/${(first.result as Json).orderId}/status`, headers: { cookie: `jh_checkout=${cookieOf(other)}` } });
      assert.equal(stolen.statusCode, 404);
    });

    it('does not give a guest first-order discounts, even for a number that already ordered', async () => {
      const [promo] = await t.db.insert(promotions).values({ name: 'Welcome', status: 'active', kind: 'percentage', configuration: { version: 1, percent: 50 }, firstOrderOnly: true }).returning();
      await t.db.insert(promotionCodes).values({ promotionId: promo!.id, code: 'WELCOME50' });
      const p = phone();
      const first = await checkout(p, KEY('fo1'), { promotionCodes: ['WELCOME50'] });
      const second = await checkout(p, KEY('fo2'), { promotionCodes: ['WELCOME50'] });
      for (const res of [first, second]) {
        assert.equal(res.statusCode, 201);
        assert.equal((res.result as Json).quote.discountMinor, 0);
      }
      assert.deepEqual((first.result as Json).quote.promotions.rejectedCodes, [{ code: 'WELCOME50', reason: 'NOT_ELIGIBLE' }]);
      const signedIn = await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone: phone(), password: 'correct horse battery' } });
      const mine = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: body(phone(), { promotionCodes: ['WELCOME50'] }), headers: { 'idempotency-key': KEY('fo3'), authorization: `Bearer ${(signedIn.result as Json).accessToken}` } });
      assert.equal((mine.result as Json).quote.discountMinor, 50000, 'a signed-in customer on their first order still gets it');
    });
  });

  describe('quotes for signed-in customers', () => {
    it('apply the same customer-only offers that checkout will, so the bag and checkout totals agree', async () => {
      const quote = (headers: Record<string, string> = {}) =>
        api.inject({ method: 'POST', url: '/api/v1/pricing/quote', payload: { items: [{ variantId, quantity: 1 }], promotionCodes: ['WELCOME50'] }, headers });
      const guest = (await quote()).result as Json;
      assert.equal(guest.discountMinor, 0);
      assert.deepEqual(guest.promotions.rejectedCodes, [{ code: 'WELCOME50', reason: 'NOT_ELIGIBLE' }]);

      const reg = await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone: phone(), password: 'correct horse battery' } });
      const auth = { authorization: `Bearer ${(reg.result as Json).accessToken}` };
      const mine = (await quote(auth)).result as Json;
      assert.equal(mine.discountMinor, 50000);
      assert.equal(mine.promotions.rejectedCodes.length, 0);

      const checkoutQuote = await api.inject({ method: 'POST', url: '/api/v1/checkout', payload: body(phone(), { promotionCodes: ['WELCOME50'] }), headers: { 'idempotency-key': KEY('qa-agree'), ...auth } });
      assert.equal((checkoutQuote.result as Json).quote.discountMinor, mine.discountMinor);

      // A rubbish token is treated as a guest, not an error.
      assert.equal(((await quote({ authorization: 'Bearer not.a.token' })).result as Json).discountMinor, 0);
    });
  });

  describe('responses', () => {
    it('carries security headers', async () => {
      const res = await api.inject('/api/v1/meta');
      assert.match(String(res.headers['strict-transport-security']), /max-age=31536000/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
    });

    it('serves time-limited image URLs built from stored keys, and null urls without storage', async () => {
      const detail = ((await api.inject('/api/v1/products/hard-wig')).result as Json).data;
      assert.match(detail.media[0].url, /^https:\/\/storage\.test\/products\/.+\/cover\.webp/);
      assert.ok(detail.media[0].objectKey, 'the key stays available too');
      const list = ((await api.inject('/api/v1/products?q=hardening')).result as Json).data;
      assert.match(list[0].image.url, /cover\.webp/);
      const suggestions = ((await api.inject('/api/v1/products/suggestions?q=hard')).result as Json).data;
      assert.match(suggestions[0].image.url, /cover\.webp/);

      await t.db.insert(contentEntries).values({ contentType: 'banner', slug: 'hero', title: 'hero', body: { headline: 'Hi', imageObjectKey: 'banners/hero.webp' }, status: 'published' });
      const home = ((await api.inject('/api/v1/storefront/home')).result as Json).data;
      assert.match(home.sections.find((x: Json) => x.type === 'hero').cards[0].imageUrl, /banners\/hero\.webp/);

      const bare = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
      await bare.initialize();
      assert.equal((((await bare.inject('/api/v1/products/hard-wig')).result as Json).data.media[0]).url, null);
      await bare.stop();
    });

    it('adds signed image URLs to the admin product views', async () => {
      const id = (await t.db.select().from(products).where(eq(products.slug, 'hard-wig')))[0]!.id;
      const detail = (await api.inject({ url: `/api/v1/admin/products/${id}`, headers: owner.headers })).result as Json;
      assert.match(detail.media[0].url, /cover\.webp/);
      const list = (await api.inject({ url: '/api/v1/admin/products?q=hardening', headers: owner.headers })).result as Json;
      assert.match(list.data[0].coverUrl, /cover\.webp/);
    });
  });

  describe('audit trail', () => {
    it('commits a change and its audit record together: if the audit write fails, the change is not kept', async () => {
      await t.db.execute(sql`create function zz_audit_down() returns trigger language plpgsql as $$ begin raise exception 'audit store unavailable'; end $$`);
      await t.db.execute(sql`create trigger zz_audit_down before insert on admin_audit_log for each row execute function zz_audit_down()`);
      try {
        const res = await api.inject({ method: 'POST', url: '/api/v1/admin/products', payload: { title: 'Unaudited Wig' }, headers: owner.headers });
        assert.equal(res.statusCode, 500);
        assert.equal((await t.db.select().from(products).where(eq(products.title, 'Unaudited Wig'))).length, 0, 'no product without its audit record');
      } finally {
        await t.db.execute(sql`drop trigger zz_audit_down on admin_audit_log`);
        await t.db.execute(sql`drop function zz_audit_down()`);
      }
      assert.equal((await api.inject({ method: 'POST', url: '/api/v1/admin/products', payload: { title: 'Audited Wig' }, headers: owner.headers })).statusCode, 201);
    });
  });

  describe('configuration and content', () => {
    it('refuses to start on Railway without an explicit NODE_ENV', () => {
      assert.throws(() => loadEnv({ RAILWAY_ENVIRONMENT: 'production' }), /NODE_ENV must be set explicitly/);
      assert.doesNotThrow(() => loadEnv({ RAILWAY_ENVIRONMENT: 'production', NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db', REDIS_URL: 'redis://h' }));
    });

    it('rejects protocol-relative and script links in content but accepts site paths and https', async () => {
      const post = (ctaUrl: string) => api.inject({ method: 'POST', url: '/api/v1/admin/content', payload: { contentType: 'banner', title: 'x', body: { headline: 'h', ctaUrl } }, headers: owner.headers });
      for (const bad of ['//evil.example/phish', '/\\evil.example', 'javascript:alert(1)', 'http://']) assert.equal((await post(bad)).statusCode, 422, bad);
      for (const good of ['/shop', '/shop?x=1', 'https://example.com/a']) assert.equal((await post(good)).statusCode, 201, good);
    });

    it('holds stock for the configured payment windows', async () => {
      const set = (payload: Json) => api.inject({ method: 'PATCH', url: '/api/v1/admin/settings/payments', payload, headers: owner.headers });
      assert.equal((await set({ transferHoldMinutes: 5 })).statusCode, 422, 'at least 15 minutes');
      assert.equal((await set({ cardHoldMinutes: 20, transferHoldMinutes: 90 })).statusCode, 200);
      const minutesLeft = async (method: string) => {
        const res = await checkout(phone(), KEY(`win-${method}`), { paymentMethod: method });
        return (new Date(((res.result as Json).reservationExpiresAt as string)).getTime() - Date.now()) / 60_000;
      };
      const card = await minutesLeft('card');
      const transfer = await minutesLeft('bank_transfer');
      assert.ok(card > 18 && card <= 20, `card ${card}`);
      assert.ok(transfer > 88 && transfer <= 90, `transfer ${transfer}`);
    });
  });
});
