import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { categories, customers, deliveryZones, orders, productCategories, promotionCodes, promotions } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { S3Storage } from '../../modules/media/storage.js';
import { createServer } from '../../server.js';
import { adminTestEnv, signInAdmin } from '../../testing/admin.js';
import { makeProduct } from '../../testing/catalog-fixtures.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeStorage } from '../../testing/fake-storage.js';

type Json = Record<string, any>;
const day = 86_400_000;

describe('home sections, customer segments and CDN URLs', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;

  const home = async () => ((await api.inject('/api/v1/storefront/home')).result as Json).data as Json;
  const types = async () => (await home()).sections.map((s: Json) => s.type) as string[];
  const section = async (type: string) => (await home()).sections.find((s: Json) => s.type === type) as Json | undefined;
  const create = (contentType: string, body: Json, extra: Json = {}) =>
    api.inject({ method: 'POST', url: '/api/v1/admin/content', payload: { contentType, title: `${contentType} ${Math.random().toString(36).slice(2, 6)}`, body, status: 'published', ...extra }, headers: owner.headers });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, storage: new FakeStorage() });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    support = await signInAdmin(t.db, api, 'support');
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('home sections (A5)', () => {
    it('with nothing configured still shows shop-by-length and trust, and nothing empty', async () => {
      assert.deepEqual(await types(), ['length', 'trust']);
      const length = await section('length');
      assert.equal(length!.items.length, 5);
      assert.deepEqual(length!.items[0], { label: '10–14"', hint: 'Shoulder', lengths: [10, 12, 14] });
      assert.deepEqual((await section('trust'))!.items.map((i: Json) => i.title), ['Secure pay', '7-day returns', 'Real reviews']);
    });

    it('renders hero cards, stories, tiles and announcements from content, in the default order', async () => {
      assert.equal((await create('announcement', { text: 'Free delivery over ₦150k' })).statusCode, 201);
      assert.equal((await create('banner', { tag: 'NEW', headline: 'Silk press season', tone: 'blush', imageObjectKey: 'banners/a.webp', ctaLabel: 'Shop', ctaUrl: '/shop/frontal' })).statusCode, 201);
      for (const title of ['Frontals', 'Bobs']) assert.equal((await create('story', { title, linkUrl: '/shop/x', highlight: title === 'Bobs' })).statusCode, 201);
      for (const title of ['A', 'B', 'C', 'D']) assert.equal((await create('tile', { title, linkUrl: '/shop/x' })).statusCode, 201);

      const data = await home();
      assert.deepEqual(data.announcements.map((a: Json) => a.text), ['Free delivery over ₦150k']);
      assert.deepEqual(data.sections.map((s: Json) => s.type), ['stories', 'hero', 'length', 'tiles', 'trust']);
      const card = (await section('hero'))!.cards[0];
      assert.deepEqual([card.tag, card.tone, card.headline], ['NEW', 'blush', 'Silk press season']);
      assert.match(card.imageUrl, /banners\/a\.webp/);
      assert.deepEqual((await section('stories'))!.items.map((s: Json) => [s.title, s.highlight ?? false]), [['Frontals', false], ['Bobs', true]]);
      assert.equal((await section('tiles'))!.items.length, 3, 'a bento grid holds three');
    });

    it('builds the picks tabs from featured, on-offer and hair-care products, omitting empty tabs', async () => {
      assert.equal(await section('products'), undefined, 'no products, no section');
      const featured = await makeProduct(t, 'pick-featured', { featured: true, variants: [{ sku: 'PF', pick: {}, price: 1000 }] });
      await makeProduct(t, 'pick-deal', { variants: [{ sku: 'PD', pick: {}, price: 1000, compareAt: 2000 }] });
      const care = await makeProduct(t, 'pick-care', { variants: [{ sku: 'PC', pick: {}, price: 1000 }] });
      const [cat] = await t.db.select().from(categories).where(eq(categories.slug, 'hair-care'));
      await t.db.insert(productCategories).values({ productId: care.id, categoryId: cat!.id });
      void featured;

      const products = (await section('products'))!;
      assert.equal(products.title, "Jetty's picks");
      assert.deepEqual(products.tabs.map((x: Json) => [x.key, x.products.map((p: Json) => p.slug)]), [['featured', ['pick-featured']], ['deal', ['pick-deal']], ['care', ['pick-care']]]);

      const curated = await create('featured_products', { heading: 'Staff favourites', productIds: [care.id] });
      assert.equal(curated.statusCode, 201);
      const again = (await section('products'))!;
      assert.equal(again.title, 'Staff favourites');
      assert.deepEqual(again.tabs[0].products.map((p: Json) => p.slug), ['pick-care']);
    });

    it('shows a flash strip only while its promotion is live and has an end to count down to', async () => {
      const [promo] = await t.db.insert(promotions).values({ name: 'Flash 15', status: 'active', kind: 'percentage', configuration: { version: 1, percent: 15 }, endsAt: new Date(Date.now() + 3 * 3_600_000) }).returning();
      await t.db.insert(promotionCodes).values([{ promotionId: promo!.id, code: 'ZZFLASH' }, { promotionId: promo!.id, code: 'FLASH15' }]);
      assert.equal((await create('flash', { promotionId: '00000000-0000-4000-8000-000000000000' })).statusCode, 422, 'must point at a real promotion');
      assert.equal((await create('flash', { promotionId: promo!.id, headline: 'Flash: 15% off frontals' })).statusCode, 201);

      const flash = (await section('flash'))!;
      assert.deepEqual([flash.headline, flash.code, flash.promotionId], ['Flash: 15% off frontals', 'FLASH15', promo!.id]);
      assert.ok(new Date(flash.endsAt).getTime() > Date.now());
      assert.ok((await types()).indexOf('flash') < (await types()).indexOf('products'), 'canonical order puts it above the picks');

      await t.db.update(promotions).set({ endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - day) }).where(eq(promotions.id, promo!.id));
      assert.equal(await section('flash'), undefined, 'ended');
      await t.db.update(promotions).set({ endsAt: null, startsAt: null }).where(eq(promotions.id, promo!.id));
      assert.equal(await section('flash'), undefined, 'nothing to count down to');
      await t.db.update(promotions).set({ endsAt: new Date(Date.now() + day), status: 'inactive' }).where(eq(promotions.id, promo!.id));
      assert.equal(await section('flash'), undefined, 'deactivated');
    });

    it('offers same-day delivery in the trust block only when a zone provides it', async () => {
      assert.ok(!(await section('trust'))!.items.some((i: Json) => i.title === 'Same-day Lagos'));
      await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', sameDayFeeMinor: 300000, active: true });
      assert.ok((await section('trust'))!.items.some((i: Json) => i.title === 'Same-day Lagos'));
    });

    it('obeys the home layout: order, hidden blocks, blocks left out, and one layout only', async () => {
      const layout = await create('home_layout', { sections: [{ type: 'trust' }, { type: 'hero' }, { type: 'length', enabled: false }, { type: 'products' }] });
      assert.equal(layout.statusCode, 201, JSON.stringify(layout.result));
      assert.equal((layout.result as Json).slug, 'home');
      assert.deepEqual(await types(), ['trust', 'hero', 'products'], 'listed order; hidden and unlisted blocks are gone');
      assert.equal((await create('home_layout', { sections: [{ type: 'hero' }] })).statusCode, 409, 'a second layout is a conflict');

      const id = ((layout.result as Json).id) as string;
      const bad = (sections: Json[]) => api.inject({ method: 'PATCH', url: `/api/v1/admin/content/${id}`, payload: { body: { sections } }, headers: owner.headers });
      assert.equal((await bad([{ type: 'carousel' }])).statusCode, 422);
      assert.equal((await bad([{ type: 'hero' }, { type: 'hero' }])).statusCode, 422, 'each block at most once');
      assert.equal((await bad([{ type: 'trust' }])).statusCode, 200);
      assert.deepEqual(await types(), ['trust']);
    });

    it('validates the new content types and keeps links local or https', async () => {
      assert.equal((await create('story', { title: 'No link' })).statusCode, 422);
      assert.equal((await create('tile', { title: 'Evil', linkUrl: '//evil.example' })).statusCode, 422);
      assert.equal((await create('banner', { headline: 'Tone', tone: 'neon' })).statusCode, 422);
      assert.equal((await create('story', { title: 'This story title is much, much too long to fit in a circle', linkUrl: '/x' })).statusCode, 422);
      assert.equal((await api.inject({ method: 'POST', url: '/api/v1/admin/content', payload: { contentType: 'story', title: 's', body: { title: 's', linkUrl: '/x' } }, headers: support.headers })).statusCode, 403);
    });
  });

  describe('customer segments (A9)', () => {
    const ids: Record<string, string> = {};
    const customer = async (key: string, phone: string) => {
      const [c] = await t.db.insert(customers).values({ phoneE164: phone, status: 'active' }).returning();
      ids[key] = c!.id;
      return c!.id;
    };
    const order = (customerId: string, totalMinor: number, ageDays: number) =>
      t.db.insert(orders).values({ orderNumber: `JH-SEG-${Math.random().toString(36).slice(2, 9)}`, customerId, phoneE164: '+2348000000000', subtotalMinor: totalMinor, totalMinor, deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date(), status: 'delivered', paymentStatus: 'paid', placedAt: new Date(Date.now() - ageDays * day) });
    const list = async (query = '') => ((await api.inject({ url: `/api/v1/admin/customers?limit=100${query}`, headers: owner.headers })).result as Json).data as Json[];

    before(async () => {
      for (let i = 0; i < 5; i++) await order(await (i === 0 ? customer('frequent', '+2348060000001') : Promise.resolve(ids.frequent!)), 10_000, 100 + i * 10);
      await order(await customer('big', '+2348060000002'), 150_000_000, 60);
      for (const age of [40, 3]) await order(ids.returning ?? (await customer('returning', '+2348060000003')), 20_000, age);
      await order(await customer('lapsed', '+2348060000004'), 20_000, 200);
      await order(await customer('fresh', '+2348060000005'), 20_000, 2);
      await customer('never', '+2348060000006');
      await t.db.insert(orders).values({ orderNumber: 'JH-SEG-UNPAID', customerId: ids.never!, phoneE164: '+2348000000000', subtotalMinor: 1, totalMinor: 1, deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date() });
    });

    it('counts each segment and explains its rule', async () => {
      const res = (await api.inject({ url: '/api/v1/admin/customers/segments', headers: owner.headers })).result as Json;
      assert.equal(res.everyone, 6);
      const by = Object.fromEntries(res.segments.map((s: Json) => [s.key, s.count]));
      // frequent: 5 orders, last one 100 days ago (VIP, returning, not lapsed). returning: first order 40 days ago (not new).
      assert.deepEqual(by, { vip: 2, new: 1, returning: 2, lapsed: 1 });
      assert.ok(res.segments.every((s: Json) => s.label && s.rule));
    });

    it('filters the list by segment and tags every row consistently with the counts', async () => {
      const all = await list();
      const tagged = (key: string) => all.filter((c) => c.segments.includes(key)).map((c) => c.id).sort();
      assert.deepEqual(tagged('vip'), [ids.frequent, ids.big].sort(), 'spend over ₦1M, or five orders');
      assert.deepEqual(tagged('new'), [ids.fresh]);
      assert.deepEqual(tagged('returning'), [ids.frequent, ids.returning].sort());
      assert.deepEqual(tagged('lapsed'), [ids.lapsed]);
      for (const key of ['vip', 'new', 'returning', 'lapsed']) {
        assert.deepEqual((await list(`&segment=${key}`)).map((c) => c.id).sort(), tagged(key), `?segment=${key} agrees with the tags`);
      }
      assert.equal((await api.inject({ url: '/api/v1/admin/customers?segment=whales', headers: owner.headers })).statusCode, 422);
      assert.equal(all.find((c) => c.id === ids.never)!.segments.length, 0, 'unpaid orders do not count');
      assert.equal((await api.inject({ url: '/api/v1/admin/customers/segments', headers: support.headers })).statusCode, 200, 'support can read customers');
    });
  });

  describe('CDN image URLs', () => {
    const s3 = (publicBaseUrl?: string) => new S3Storage({ endpoint: 'https://acct.r2.test', bucket: 'jetty', accessKeyId: 'AK', secretAccessKey: 'SECRET', region: 'auto', publicBaseUrl });

    it('use stable public URLs when a CDN is configured, whatever the time', () => {
      const cdn = s3('https://media.example.com/');
      const key = 'products/p 1/cover (1).webp';
      const a = cdn.urlFor(key, new Date('2026-01-01T00:00:00Z'));
      assert.equal(a, 'https://media.example.com/products/p%201/cover%20%281%29.webp');
      assert.equal(cdn.urlFor(key, new Date('2027-06-06T06:06:06Z')), a);
      assert.ok(!a.includes('SECRET') && !a.includes('Signature'));
    });

    it('fall back to presigned URLs that only change on the hour', () => {
      const bare = s3();
      const sameHour = [bare.urlFor('k.webp', new Date('2026-01-01T10:05:00Z')), bare.urlFor('k.webp', new Date('2026-01-01T10:59:59Z'))];
      assert.equal(sameHour[0], sameHour[1]);
      assert.match(sameHour[0]!, /X-Amz-Signature=/);
      assert.notEqual(bare.urlFor('k.webp', new Date('2026-01-01T11:00:00Z')), sameHour[0]);
      assert.equal(new URL(sameHour[0]!).searchParams.get('X-Amz-Expires'), '7200');
    });

    it('is configured by MEDIA_PUBLIC_BASE_URL', () => {
      assert.equal(loadEnv({ NODE_ENV: 'test', MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' }).MEDIA_PUBLIC_BASE_URL, 'https://media.example.com');
      assert.equal(loadEnv({ NODE_ENV: 'test' }).MEDIA_PUBLIC_BASE_URL, undefined);
      assert.throws(() => loadEnv({ NODE_ENV: 'test', MEDIA_PUBLIC_BASE_URL: 'not a url' }), /MEDIA_PUBLIC_BASE_URL/);
    });
  });
});
