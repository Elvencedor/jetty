import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, deliveryZones, inventory, orderItems, orders, productVariants, products, reviews } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { STARTER_PAGES } from '../../../db/starter-pages.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { FakeProvider } from '../../../testing/fake-provider.js';

type Json = Record<string, any>;
const day = 86_400_000;

describe('admin content, customers, reviews and settings', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let manager: Awaited<ReturnType<typeof signInAdmin>>;
  let editor: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let productId = '';
  let variantId = '';

  const call = async (method: string, url: string, payload?: Json, who = owner) => {
    const res = await api.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const publicGet = async (url: string) => ({ status: (await api.inject({ url: `/api/v1${url}` })).statusCode, body: (await api.inject({ url: `/api/v1${url}` })).result as Json });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    manager = await signInAdmin(t.db, api, 'manager');
    editor = await signInAdmin(t.db, api, 'content_editor');
    support = await signInAdmin(t.db, api, 'support');
    const [p] = await t.db.insert(products).values({ slug: 'mgmt-wig', title: 'Mgmt Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'MG-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 50 });
    productId = p!.id;
    variantId = v!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('content', () => {
    it('validates each body type, and only editors/managers can write', async () => {
      assert.equal((await call('POST', '/admin/content', { contentType: 'announcement', title: 'a', body: { text: 'x' } }, support)).status, 403);
      assert.equal((await call('POST', '/admin/content', { contentType: 'announcement', title: 'a', body: {} }, editor)).status, 422);
      assert.equal((await call('POST', '/admin/content', { contentType: 'banner', title: 'a', body: { headline: 'h', ctaUrl: 'javascript:alert(1)' } }, editor)).status, 422, 'script URLs are refused');
      assert.equal((await call('POST', '/admin/content', { contentType: 'featured_products', title: 'f', body: { productIds: ['00000000-0000-4000-8000-000000000000'] } })).status, 422);
      assert.equal((await call('POST', '/admin/content', { contentType: 'page', title: 'p', body: { markdown: 'x' }, startsAt: new Date(Date.now() + day), endsAt: new Date() })).status, 422);
    });

    it('drives the storefront: draft is invisible, publishing and scheduling take effect, archiving removes', async () => {
      const banner = await call('POST', '/admin/content', { contentType: 'banner', title: 'Summer', body: { headline: 'Summer drop', ctaLabel: 'Shop', ctaUrl: '/shop' } }, editor);
      assert.equal(banner.status, 201, JSON.stringify(banner.body));
      assert.equal(banner.body.status, 'draft');
      const home = async () => {
        const data = ((await api.inject({ url: '/api/v1/storefront/home' })).result as Json).data;
        const section = (type: string) => data.sections.find((x: Json) => x.type === type);
        return { banners: section('hero')?.cards ?? [], featured: { products: section('products')?.tabs.find((t: Json) => t.key === 'featured')?.products ?? [] } };
      };
      assert.equal((await home()).banners.length, 0);

      await call('PATCH', `/admin/content/${banner.body.id}`, { status: 'published' }, editor);
      assert.deepEqual((await home()).banners.map((b: Json) => b.headline), ['Summer drop']);

      await call('PATCH', `/admin/content/${banner.body.id}`, { startsAt: new Date(Date.now() + day) }, editor);
      assert.equal((await home()).banners.length, 0, 'scheduled for later');
      await call('PATCH', `/admin/content/${banner.body.id}`, { startsAt: null, status: 'archived' }, editor);
      assert.equal((await home()).banners.length, 0);

      const row = await call('POST', '/admin/content', { contentType: 'featured_products', title: 'Picks', body: { heading: "Jetty's picks", productIds: [productId] }, status: 'published' });
      assert.equal(row.status, 201);
      assert.deepEqual((await home()).featured.products.map((p: Json) => p.slug), ['mgmt-wig']);
    });

    it('serves pages by slug, keeps slugs unique per type, and lists with filters', async () => {
      const page = await call('POST', '/admin/content', { contentType: 'page', title: 'Warranty', slug: 'warranty', body: { markdown: '# Warranty\n30 days.' }, status: 'published' });
      assert.equal(page.status, 201);
      assert.equal((await publicGet('/content/pages/warranty')).body.data.title, 'Warranty');
      assert.equal((await call('POST', '/admin/content', { contentType: 'page', title: 'Dup', slug: 'warranty', body: { markdown: 'x' } })).status, 409);
      const a = await call('POST', '/admin/content', { contentType: 'announcement', title: 'Promo bar', body: { text: 'A' } });
      const b = await call('POST', '/admin/content', { contentType: 'announcement', title: 'Promo bar', body: { text: 'B' } });
      assert.notEqual(a.body.slug, b.body.slug, 'auto slugs de-duplicate');
      assert.equal((await call('GET', '/admin/content?type=page&limit=100')).body.data.length, STARTER_PAGES.length + 1, 'the starter pages from the seed, plus this one');
      assert.equal((await call('GET', '/admin/content?status=draft&type=announcement')).body.data.length, 2);
      assert.equal((await call('GET', `/admin/content/${a.body.id}`)).body.title, 'Promo bar');
      assert.equal((await call('PATCH', `/admin/content/${a.body.id}`, { body: { text: '' } })).status, 422);
    });
  });

  describe('customers and reviews', () => {
    let customerId = '';
    let itemId = '';
    let reviewId = '';

    before(async () => {
      const reg = await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'mgmt1@example.com', phone: '+2348077700001', password: 'correct horse battery' } });
      customerId = (reg.result as Json).customer.id;
      for (const [i, total] of [300000, 100000].entries()) {
        const [o] = await t.db.insert(orders).values({ orderNumber: `JH-M-${i}`, customerId, phoneE164: '+2348077700001', subtotalMinor: total, totalMinor: total, deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date(), status: 'delivered', paymentStatus: 'paid', placedAt: new Date() }).returning();
        const [item] = await t.db.insert(orderItems).values({ orderId: o!.id, productId, variantId, skuSnapshot: 'MG-1', titleSnapshot: 'Mgmt Wig', quantity: 1, unitPriceMinor: total, lineTotalMinor: total }).returning();
        if (i === 0) itemId = item!.id;
      }
      await t.db.insert(orders).values({ orderNumber: 'JH-M-X', customerId, phoneE164: '+2348077700001', subtotalMinor: 999, totalMinor: 999, deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date() });
      await api.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'mgmt2@example.com', phone: '+2348077700002', password: 'correct horse battery' } });
    });

    it('lists customers with order count and lifetime value over paid orders only', async () => {
      const all = await call('GET', '/admin/customers', undefined, support);
      assert.equal(all.status, 200);
      const me = all.body.data.find((c: Json) => c.id === customerId);
      assert.deepEqual([me.orderCount, me.lifetimeValueMinor], [2, 400000]);
      assert.equal((await call('GET', '/admin/customers?q=00001')).body.data.length, 1);
      const bySpend = await call('GET', '/admin/customers?sort=spend&limit=1');
      assert.equal(bySpend.body.data[0].id, customerId);
      const next = await call('GET', `/admin/customers?sort=spend&limit=1&cursor=${bySpend.body.page.nextCursor}`);
      assert.notEqual(next.body.data[0].id, customerId);
      assert.equal((await call('GET', '/admin/customers', undefined, editor)).status, 403);
      const one = await call('GET', `/admin/customers/${customerId}`);
      assert.equal(one.body.orderCount, 2);
      assert.equal(one.body.recentOrders.length, 3);
      assert.ok(!JSON.stringify(one.body).includes('passwordHash'));
    });

    it('moderates reviews: pending queue, approve makes it public, hide removes it', async () => {
      const created = await api.inject({ method: 'POST', url: '/api/v1/reviews', payload: { orderItemId: itemId, rating: 5, title: 'Great', body: 'Love it' }, headers: { authorization: `Bearer ${((await api.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'mgmt1@example.com', password: 'correct horse battery' } })).result as Json).accessToken}` } });
      assert.equal(created.statusCode, 201, JSON.stringify(created.result));
      reviewId = (created.result as Json).id;

      const queue = await call('GET', '/admin/reviews?status=pending', undefined, support);
      assert.equal(queue.status, 200);
      assert.equal(queue.body.data[0].id, reviewId);
      assert.match(queue.body.data[0].customerPhone, /^\+234••••001$/);
      assert.equal(queue.body.data[0].productTitle, 'Mgmt Wig');
      assert.equal(queue.body.data[0].customerEmail, 'm•••@example.com', 'the reviewer is shown masked, by email now that accounts are email-first');
      assert.equal(queue.body.page.total, 1, 'the first page carries the queue size, for the nav badge');
      assert.equal((await call('GET', `/admin/reviews?status=pending&cursor=${encodeURIComponent('x')}`, undefined, support)).body?.page?.total ?? null, null, 'later pages skip the count');
      assert.equal((await call('GET', '/admin/reviews', undefined, editor)).status, 403);

      const publicCount = async () => ((await api.inject({ url: `/api/v1/products/${productId}/reviews` })).result as Json).summary.count;
      assert.equal(await publicCount(), 0);
      assert.equal((await call('PATCH', `/admin/reviews/${reviewId}`, { status: 'approved' }, support)).body.status, 'approved');
      assert.equal(await publicCount(), 1);
      assert.equal(((await api.inject({ url: '/api/v1/products/mgmt-wig' })).result as Json).data.rating.count, 1);
      await call('PATCH', `/admin/reviews/${reviewId}`, { status: 'hidden' }, manager);
      assert.equal(await publicCount(), 0);
      assert.equal((await call('PATCH', `/admin/reviews/${reviewId}`, { status: 'pending' })).status, 422, 'cannot be returned to pending');
      assert.equal((await t.db.select().from(reviews).where(eq(reviews.id, reviewId)))[0]!.status, 'hidden');
      const actions = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, reviewId))).map((a) => a.action);
      assert.deepEqual(actions, ['review.moderate', 'review.moderate']);
    });
  });

  describe('settings', () => {
    it('is owner-written, merges partial updates, and validates', async () => {
      assert.equal((await call('GET', '/admin/settings/store', undefined, support)).status, 403);
      assert.equal((await call('PATCH', '/admin/settings/store', { name: 'X' }, manager)).status, 403);
      assert.equal((await call('GET', '/admin/settings/store', undefined, manager)).body.name, "Jetty's Hair", 'managers can read; defaults apply');

      const updated = await call('PATCH', '/admin/settings/store', { contactPhone: '+2348012345678', showroomAddress: '12 Allen Ave, Ikeja' });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(updated.body.name, "Jetty's Hair");
      assert.equal(updated.body.contactPhone, '+2348012345678');
      assert.equal((await call('PATCH', '/admin/settings/store', { contactPhone: '0801' })).status, 422);
      assert.equal((await call('PATCH', '/admin/settings/store', { notAField: 1 })).status, 422);
      assert.equal((await call('GET', '/admin/settings/secrets')).status, 422, 'only allow-listed keys');
      assert.equal(((await api.inject({ url: '/api/v1/storefront/settings' })).result as Json).data.store.showroomAddress, '12 Allen Ave, Ikeja');
    });

    it('turns payment methods on and off for checkout', async () => {
      const checkout = (paymentMethod: string) =>
        api.inject({
          method: 'POST',
          url: '/api/v1/checkout',
          payload: { items: [{ variantId, quantity: 1 }], promotionCodes: [], contact: { phone: '+2348066600001' }, deliveryAddress: { recipientName: 'B', addressLine1: '1 St', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod, termsAccepted: true },
          headers: { 'idempotency-key': `settings-${paymentMethod}-${Math.random().toString(36).slice(2)}-abcdefgh-0123456789abcdefghijklmnopqrstuv` },
        });
      assert.equal((await call('PATCH', '/admin/settings/payments', { enabledMethods: [] })).status, 422, 'at least one method stays on');
      await call('PATCH', '/admin/settings/payments', { enabledMethods: ['card'] });
      const refused = await checkout('bank_transfer');
      assert.equal(refused.statusCode, 422);
      assert.equal((refused.result as Json).error.code, 'PAYMENT_METHOD_UNAVAILABLE');
      assert.equal((await checkout('card')).statusCode, 201);
      await call('PATCH', '/admin/settings/payments', { enabledMethods: ['card', 'bank_transfer'] });
      assert.equal((await checkout('bank_transfer')).statusCode, 201);
    });

    it('manages delivery zones: update, add, and retire without deleting', async () => {
      const zones = (await call('GET', '/admin/settings/delivery-zones')).body.zones;
      const lagos = zones.find((z: Json) => z.state === 'Lagos' && z.nextDayFeeMinor === 150000);
      const res = await call('PATCH', '/admin/settings/delivery-zones', {
        zones: [{ id: lagos.id, sameDayFeeMinor: 250000, sameDayCutoffLocal: '13:30' }, { name: 'Abuja', state: 'FCT', nextDayFeeMinor: 300000, areas: ['Garki', 'Wuse'] }],
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const lagosAfter = res.body.zones.find((z: Json) => z.id === lagos.id);
      assert.deepEqual([lagosAfter.sameDayFeeMinor, lagosAfter.sameDayCutoffLocal, lagosAfter.nextDayFeeMinor], [250000, '13:30', 150000]);
      const abuja = res.body.zones.find((z: Json) => z.state === 'FCT');
      assert.deepEqual(abuja.areas, ['Garki', 'Wuse']);

      assert.equal((await call('PATCH', '/admin/settings/delivery-zones', { zones: [{ name: 'No state' }] })).status, 422);
      assert.equal((await call('PATCH', '/admin/settings/delivery-zones', { zones: [{ id: lagos.id, sameDayCutoffLocal: '25:00' }] })).status, 422);
      assert.equal((await call('PATCH', '/admin/settings/delivery-zones', { zones: [{ id: lagos.id, timezone: 'Mars/Base' }] })).status, 422);
      assert.equal((await call('PATCH', '/admin/settings/delivery-zones', { zones: [{ id: '00000000-0000-4000-8000-000000000000', active: false }] })).status, 404);

      await call('PATCH', '/admin/settings/delivery-zones', { zones: [{ id: abuja.id, active: false }] });
      const quote = await api.inject({ method: 'POST', url: '/api/v1/delivery/quotes', payload: { items: [{ variantId, quantity: 1 }], deliveryAddress: { state: 'FCT', area: 'Garki' } } });
      assert.equal(quote.statusCode, 422, 'a retired zone stops serving');
      const q2 = await api.inject({ method: 'POST', url: '/api/v1/delivery/quotes', payload: { items: [{ variantId, quantity: 1 }], deliveryAddress: { state: 'Lagos' } } });
      assert.ok(((q2.result as Json).options as Json[]).some((o) => o.method === 'same_day' && o.baseFeeMinor === 250000));
    });
  });
});
