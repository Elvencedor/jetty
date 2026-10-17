import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { loadEnv } from '../../config/env.js';
import {
  collections,
  customers,
  deliveryZones,
  inventory,
  productCollections,
  productVariants,
  products,
  promotionCodes,
  promotions,
} from '../../db/schema/index.js';
import { loadPromotions } from '../../modules/pricing/load-promotions.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';

type Json = Record<string, any>;

describe('pricing and delivery quotes', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let server: Server;
  const v: Record<string, string> = {};
  let lagosZone = '';

  const post = async (url: string, payload: unknown) => {
    const res = await server.inject({ method: 'POST', url, payload: payload as object });
    return { status: res.statusCode, body: res.result as Json, headers: res.headers };
  };
  const lagos = { state: 'Lagos', area: 'Lekki' };

  async function variant(key: string, price: number, stock = 10, opts: { status?: 'active' | 'draft'; collectionId?: string } = {}) {
    const [p] = await t.db.insert(products).values({ slug: key, title: key, status: opts.status ?? 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: p!.id, sku: key, optionSignature: {}, priceMinor: price }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: stock });
    if (opts.collectionId) await t.db.insert(productCollections).values({ productId: p!.id, collectionId: opts.collectionId });
    v[key] = pv!.id;
  }

  before(async () => {
    t = await createTestDatabase();
    server = await createServer({
      env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' }),
      logger: createLogger('error'),
      database: t,
    });
    await server.initialize();

    const [col] = await t.db.insert(collections).values({ slug: 'bobs', name: 'Bobs' }).returning();
    await variant('wig', 100000);
    await variant('bob', 40000, 10, { collectionId: col!.id });
    await variant('scarce', 5000, 2);
    await variant('draft', 100, 5, { status: 'draft' });

    const [zone] = await t.db
      .insert(deliveryZones)
      .values({ name: 'Lagos Mainland & Island', state: 'Lagos', sameDayCutoffLocal: '23:59', sameDayFeeMinor: 300000, nextDayFeeMinor: 200000, pickupEnabled: true })
      .returning();
    lagosZone = zone!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos Island', state: 'Lagos', areas: ['Lekki', 'Victoria Island'], nextDayFeeMinor: 250000 });
    await t.db.insert(deliveryZones).values({ name: 'Abuja', state: 'FCT', nationwideFeeMinor: 600000 });
    await t.db.insert(deliveryZones).values({ name: 'Inactive', state: 'Oyo', nextDayFeeMinor: 1, active: false });

    const promo = async (name: string, kind: 'percentage' | 'fixed_amount' | 'buy_x_get_y' | 'free_delivery', configuration: object, extra: Partial<typeof promotions.$inferInsert> = {}) =>
      (await t.db.insert(promotions).values({ name, kind, configuration, status: 'active', ...extra }).returning())[0]!;

    await promo('Auto 10%', 'percentage', { version: 1, percent: 10 }, { priority: 1 });
    const welcome = await promo('Welcome', 'fixed_amount', { version: 1, amountMinor: 50000 }, { priority: 5, stackable: true });
    await t.db.insert(promotionCodes).values({ promotionId: welcome.id, code: 'WELCOME' });
    const expired = await promo('Old', 'percentage', { version: 1, percent: 90 }, { endsAt: new Date('2026-02-01') });
    await t.db.insert(promotionCodes).values({ promotionId: expired.id, code: 'OLD' });
    const limited = await promo('Limited', 'percentage', { version: 1, percent: 20 }, { totalUsageLimit: 1, usageCount: 1 });
    await t.db.insert(promotionCodes).values({ promotionId: limited.id, code: 'GONE' });
    const free = await promo('Free delivery over 2k', 'free_delivery', { version: 1, zoneIds: [lagosZone] }, { minimumSubtotalMinor: 200000 });
    await t.db.insert(promotionCodes).values({ promotionId: free.id, code: 'FREESHIP' });
    const firstOrder = await promo('First order', 'percentage', { version: 1, percent: 30 }, { firstOrderOnly: true });
    await t.db.insert(promotionCodes).values({ promotionId: firstOrder.id, code: 'FIRST' });
    const perCustomer = await promo('Loyal', 'percentage', { version: 1, percent: 15 }, { perCustomerLimit: 1 });
    await t.db.insert(promotionCodes).values({ promotionId: perCustomer.id, code: 'LOYAL' });
  });

  after(async () => {
    await server?.stop();
    await t?.destroy();
  });

  it('prices from the catalog and applies automatic promotions', async () => {
    const { status, body, headers } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 2 }] });
    assert.equal(status, 200);
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(body.currency, 'NGN');
    assert.equal(body.subtotalMinor, 200000);
    assert.equal(body.discountMinor, 20000);
    assert.equal(body.totalMinor, 180000);
    assert.equal(body.deliveryFeeMinor, 0);
    assert.equal(body.taxMinor, 0);
    assert.equal(body.lines[0].unitPriceMinor, 100000);
    assert.equal(body.lines[0].promotionAllocations[0].amountMinor, 20000);
    assert.match(body.quoteId, /^[0-9a-f-]{36}$/);
    assert.ok(new Date(body.quoteExpiresAt) > new Date());
  });

  it('rejects client-supplied prices and unknown fields', async () => {
    const res = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1, unitPriceMinor: 1 }] });
    assert.equal(res.status, 422);
    assert.equal((await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], totalMinor: 1 })).status, 422);
  });

  it('merges duplicate lines and validates quantities', async () => {
    const { body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }, { variantId: v.wig, quantity: 1 }] });
    assert.equal(body.lines.length, 1);
    assert.equal(body.lines[0].quantity, 2);
    assert.equal((await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 0 }] })).status, 422);
    assert.equal((await post('/api/v1/pricing/quote', { items: [] })).status, 422);
  });

  it('422s unavailable, draft or unknown variants with their ids', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    const res = await post('/api/v1/pricing/quote', { items: [{ variantId: v.draft, quantity: 1 }, { variantId: missing, quantity: 1 }] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VARIANT_UNAVAILABLE');
    assert.deepEqual(res.body.error.details.map((d: Json) => d.variantId).sort(), [missing, v.draft].sort());
  });

  it('warns about stock without failing the quote', async () => {
    const { status, body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.scarce, quantity: 5 }] });
    assert.equal(status, 200);
    assert.deepEqual(body.warnings[0], { code: 'INSUFFICIENT_STOCK', variantId: v.scarce, requestedQuantity: 5, availableQuantity: 2 });
  });

  it('applies and stacks code promotions deterministically, normalising the code', async () => {
    const { body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: [' welcome '] });
    // WELCOME (priority 5, stackable) applies first; the non-stackable auto 10% then cannot combine with it.
    assert.deepEqual(body.promotions.applied.map((p: Json) => p.name), ['Welcome']);
    assert.equal(body.discountMinor, 50000);
    assert.deepEqual(body.promotions.rejectedCodes, []);
  });

  it('reports expired, exhausted and unknown codes without failing', async () => {
    const { status, body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: ['OLD', 'GONE', 'NOPE'] });
    assert.equal(status, 200);
    const reasons = Object.fromEntries(body.promotions.rejectedCodes.map((r: Json) => [r.code, r.reason]));
    assert.deepEqual(reasons, { OLD: 'EXPIRED', GONE: 'USAGE_LIMIT_REACHED', NOPE: 'INVALID_CODE' });
  });

  it('flags first-order promotions as verified at checkout when the buyer is anonymous', async () => {
    const { body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: ['FIRST'] });
    assert.ok(body.warnings.some((w: Json) => w.code === 'CUSTOMER_ELIGIBILITY_VERIFIED_AT_CHECKOUT'));
  });

  it('does not apply per-customer-limited codes to guests', async () => {
    const { status, body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: ['LOYAL'] });
    assert.equal(status, 200);
    assert.deepEqual(body.promotions.rejectedCodes, [{ code: 'LOYAL', reason: 'NOT_ELIGIBLE' }]);
    assert.ok(body.promotions.applied.every((p: Json) => p.code !== 'LOYAL'));
  });

  it('applies per-customer-limited codes when a customer is identified', async () => {
    const [customer] = await t.db.insert(customers).values({ email: 'loyal@example.com' }).returning();
    const loaded = await loadPromotions(t.db, { codes: ['LOYAL'], now: new Date(), customerId: customer!.id });
    assert.ok(loaded.promotions.some((p) => p.code === 'LOYAL'));
    assert.deepEqual(loaded.rejections, []);
  });

  it('adds the admin-configured delivery fee to the total', async () => {
    const { status, body } = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.scarce, quantity: 1 }],
      deliveryAddress: { state: 'lagos', area: 'Ikeja' },
      deliveryMethod: 'next_day',
    });
    assert.equal(status, 200);
    assert.equal(body.delivery.zoneName, 'Lagos Mainland & Island');
    assert.equal(body.deliveryFeeMinor, 200000);
    assert.equal(body.totalMinor, body.subtotalMinor - body.discountMinor + 200000);
  });

  it('prefers the zone that lists the destination area over the state-wide zone', async () => {
    const { body } = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.scarce, quantity: 1 }],
      deliveryAddress: { state: 'Lagos', area: ' lekki ' },
      deliveryMethod: 'next_day',
    });
    assert.equal(body.delivery.zoneName, 'Lagos Island');
    assert.equal(body.deliveryFeeMinor, 250000);
  });

  it('makes delivery free when a free-delivery promotion matches zone and minimum spend', async () => {
    const big = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.wig, quantity: 3 }],
      promotionCodes: ['FREESHIP'],
      deliveryAddress: { state: 'Lagos', area: 'Ikeja' },
      deliveryMethod: 'same_day',
    });
    assert.equal(big.body.deliveryFeeMinor, 0);
    assert.equal(big.body.delivery.baseFeeMinor, 300000);
    assert.equal(big.body.delivery.freeDeliveryPromotionId !== null, true);

    const small = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.scarce, quantity: 1 }],
      promotionCodes: ['FREESHIP'],
      deliveryAddress: { state: 'Lagos', area: 'Ikeja' },
      deliveryMethod: 'same_day',
    });
    assert.equal(small.body.deliveryFeeMinor, 300000);
  });

  it('422s unserviceable destinations and unoffered methods', async () => {
    const items = [{ variantId: v.scarce, quantity: 1 }];
    const unknown = await post('/api/v1/pricing/quote', { items, deliveryAddress: { state: 'Kano' }, deliveryMethod: 'next_day' });
    assert.equal(unknown.body.error.code, 'DELIVERY_UNAVAILABLE');
    const inactive = await post('/api/v1/pricing/quote', { items, deliveryAddress: { state: 'Oyo' }, deliveryMethod: 'next_day' });
    assert.equal(inactive.body.error.code, 'DELIVERY_UNAVAILABLE');
    const method = await post('/api/v1/pricing/quote', { items, deliveryAddress: { state: 'FCT' }, deliveryMethod: 'same_day' });
    assert.equal(method.status, 422);
    assert.equal(method.body.error.code, 'DELIVERY_METHOD_UNAVAILABLE');
    assert.equal((await post('/api/v1/pricing/quote', { items, deliveryMethod: 'next_day' })).status, 422);
  });

  it('returns delivery options with fees, estimates and free-delivery pricing', async () => {
    const { status, body } = await post('/api/v1/delivery/quotes', {
      items: [{ variantId: v.wig, quantity: 3 }],
      promotionCodes: ['FREESHIP'],
      deliveryAddress: { state: 'Lagos', area: 'Ikeja' },
    });
    assert.equal(status, 200);
    assert.equal(body.zone.id, lagosZone);
    const by = Object.fromEntries(body.options.map((o: Json) => [o.method, o]));
    assert.deepEqual(Object.keys(by).sort(), ['next_day', 'pickup', 'same_day']);
    assert.equal(by.same_day.baseFeeMinor, 300000);
    assert.equal(by.same_day.feeMinor, 0);
    assert.equal(by.pickup.estimate, null);
    assert.match(by.next_day.estimate.earliestDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('delivery quotes validate the cart and destination', async () => {
    assert.equal((await post('/api/v1/delivery/quotes', { items: [{ variantId: v.wig, quantity: 1 }] })).status, 422);
    assert.equal((await post('/api/v1/delivery/quotes', { items: [{ variantId: v.draft, quantity: 1 }], deliveryAddress: lagos })).status, 422);
    const none = await post('/api/v1/delivery/quotes', { items: [{ variantId: v.wig, quantity: 1 }], deliveryAddress: { state: 'Kano' } });
    assert.equal(none.body.error.code, 'DELIVERY_UNAVAILABLE');
  });
});
