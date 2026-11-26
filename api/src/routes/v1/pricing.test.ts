import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import {
  collections,
  customers,
  deliveryZones,
  inventory,
  productCollections,
  productVariants,
  products,
  orders,
  promotionCodes,
  promotionRedemptions,
  promotions,
} from '../../db/schema/index.js';
import { priceCart } from '../../modules/pricing/cart.js';
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
      .values({ name: 'Lagos Mainland & Island', state: 'Lagos', deliveryFeeMinor: 300000, deliveryMinDays: 1, deliveryMaxDays: 2, pickupEnabled: true })
      .returning();
    lagosZone = zone!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos Island', state: 'Lagos', areas: ['Lekki', 'Victoria Island'], deliveryFeeMinor: 250000 });
    await t.db.insert(deliveryZones).values({ name: 'Abuja', state: 'FCT', deliveryFeeMinor: 600000, deliveryMinDays: 2, deliveryMaxDays: 4 });
    await t.db.insert(deliveryZones).values({ name: 'Inactive', state: 'Oyo', deliveryFeeMinor: 1, active: false });
    // A nationwide zone covers the listed states. Lagos and the FCT also have zones of their own, and Rivers has one for
    // Port Harcourt only: in each case the state zone must win where it applies.
    await t.db.insert(deliveryZones).values({ name: 'Nationwide', scope: 'nationwide', state: null, states: ['Kaduna', 'Enugu', 'FCT', 'Lagos', 'Rivers'], deliveryFeeMinor: 700000, deliveryMinDays: 2, deliveryMaxDays: 4 });
    await t.db.insert(deliveryZones).values({ name: 'Port Harcourt', state: 'Rivers', areas: ['Port Harcourt'], deliveryFeeMinor: 450000 });
    await t.db.insert(deliveryZones).values({ name: 'Ibadan North', state: 'Ogun', areas: ['Abeokuta'], deliveryFeeMinor: 200000 });
    await t.db.insert(deliveryZones).values({ name: 'Ogun Far', state: 'Ogun', areas: ['Ijebu'], deliveryFeeMinor: 500000 });
    await t.db.insert(deliveryZones).values({ name: 'Old nationwide', scope: 'nationwide', state: null, states: ['Kwara'], deliveryFeeMinor: 1, active: false });

    const promo = async (name: string, kind: 'percentage' | 'fixed_amount' | 'buy_x_get_y' | 'free_delivery', configuration: object, extra: Partial<typeof promotions.$inferInsert> = {}) =>
      (await t.db.insert(promotions).values({ name, kind, configuration, status: 'active', ...extra }).returning())[0]!;

    await promo('Auto 10%', 'percentage', { version: 1, percent: 10 }, { priority: 1 });
    const welcome = await promo('Welcome', 'fixed_amount', { version: 1, amountMinor: 50000 });
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

  it('says which item is unavailable and why, so a client can name it', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    const res = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }, { variantId: v.draft, quantity: 1 }, { variantId: missing, quantity: 1 }] });
    const details = res.body.error.details as Json[];
    assert.deepEqual(details.map((d) => d.variantId).sort(), [missing, v.draft].sort(), 'only the ones that cannot be bought');
    const hidden = details.find((d) => d.variantId === v.draft)!;
    assert.equal(hidden.reason, 'NOT_FOR_SALE');
    assert.equal(typeof hidden.productTitle, 'string');
    assert.equal(typeof hidden.optionSummary, 'string');
    assert.deepEqual(details.find((d) => d.variantId === missing), { variantId: missing, productTitle: null, optionSummary: '', reason: 'REMOVED' });

    const one = await post('/api/v1/pricing/quote', { items: [{ variantId: v.draft, quantity: 1 }] });
    assert.match(one.body.error.message, new RegExp(`^${String(hidden.productTitle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.* is no longer available\\.$`), 'the message names the product');
    const gone = await post('/api/v1/pricing/quote', { items: [{ variantId: missing, quantity: 1 }] });
    assert.equal(gone.body.error.message, 'An item in your bag is no longer available.', 'an item that no longer exists cannot be named');
  });

  it('warns about stock without failing the quote', async () => {
    const { status, body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.scarce, quantity: 5 }] });
    assert.equal(status, 200);
    assert.deepEqual(body.warnings[0], { code: 'INSUFFICIENT_STOCK', variantId: v.scarce, requestedQuantity: 5, availableQuantity: 2 });
  });

  it('applies a code on top of the automatic discounts, normalising the code', async () => {
    const { body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: [' welcome '] });
    assert.deepEqual(body.promotions.applied.map((p: Json) => p.name), ['Auto 10%', 'Welcome']);
    assert.equal(body.discountMinor, 10000 + 50000);
    assert.deepEqual(body.promotions.rejectedCodes, []);
  });

  it('accepts only one code', async () => {
    const res = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: ['WELCOME', 'FREESHIP'] });
    assert.equal(res.status, 422);
  });

  it('reports expired, exhausted and unknown codes without failing', async () => {
    for (const [code, reason] of [['OLD', 'EXPIRED'], ['GONE', 'USAGE_LIMIT_REACHED'], ['NOPE', 'INVALID_CODE']] as const) {
      const { status, body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: [code] });
      assert.equal(status, 200);
      assert.deepEqual(body.promotions.rejectedCodes, [{ code, reason }]);
      assert.equal(body.discountMinor, 10000, 'the automatic discount stays');
    }
  });

  it('does not apply first-order promotions to guests and tells the client to sign in', async () => {
    const { body } = await post('/api/v1/pricing/quote', { items: [{ variantId: v.wig, quantity: 1 }], promotionCodes: ['FIRST'] });
    assert.deepEqual(body.promotions.rejectedCodes, [{ code: 'FIRST', reason: 'NOT_ELIGIBLE' }]);
    assert.ok(body.promotions.applied.every((p: Json) => p.code !== 'FIRST'));
    assert.ok(body.warnings.some((w: Json) => w.code === 'SIGN_IN_FOR_OFFERS'));
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

  it('respects the per-customer limit of an automatic discount', async () => {
    const [limited] = await t.db.insert(promotions).values({ name: 'Once each', kind: 'percentage', configuration: { version: 1, percent: 50 }, status: 'active', perCustomerLimit: 1 }).returning();
    const [customer] = await t.db.insert(customers).values({ email: 'once@example.com' }).returning();
    const items = [{ variantId: v.wig!, quantity: 1 }];
    const names = async (customerId?: string) => (await priceCart(t.db, { items, promotionCodes: [], customerId })).promotions.applied.map((p) => p.name);
    try {
      assert.deepEqual(await names(), ['Auto 10%'], 'a guest cannot be checked, so does not get it');
      assert.deepEqual(await names(customer!.id), ['Once each']);
      const [order] = await t.db.insert(orders).values({ orderNumber: 'JH-ONCE-1', customerId: customer!.id, phoneE164: '+2348011110000', subtotalMinor: 100000, totalMinor: 50000, deliveryAddressSnapshot: {}, deliveryMethod: 'delivery', termsAcceptedAt: new Date() }).returning();
      await t.db.insert(promotionRedemptions).values({ promotionId: limited!.id, customerId: customer!.id, orderId: order!.id, discountMinor: 50000 });
      assert.deepEqual(await names(customer!.id), ['Auto 10%'], 'once used, the next best automatic discount applies');
    } finally {
      await t.db.delete(promotionRedemptions).where(eq(promotionRedemptions.promotionId, limited!.id));
      await t.db.delete(promotions).where(eq(promotions.id, limited!.id));
    }
  });

  it('adds the admin-configured delivery fee to the total', async () => {
    const { status, body } = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.scarce, quantity: 1 }],
      deliveryAddress: { state: 'lagos', area: 'Ikeja' },
      deliveryMethod: 'delivery',
    });
    assert.equal(status, 200);
    assert.equal(body.delivery.zoneName, 'Lagos Mainland & Island');
    assert.equal(body.deliveryFeeMinor, 300000);
    assert.equal(body.totalMinor, body.subtotalMinor - body.discountMinor + 300000);
  });

  it('prefers the zone that lists the destination area over the state-wide zone', async () => {
    const { body } = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.scarce, quantity: 1 }],
      deliveryAddress: { state: 'Lagos', area: ' lekki ' },
      deliveryMethod: 'delivery',
    });
    assert.equal(body.delivery.zoneName, 'Lagos Island');
    assert.equal(body.deliveryFeeMinor, 250000);
  });

  it('makes delivery free when a free-delivery promotion matches zone and minimum spend', async () => {
    const big = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.wig, quantity: 3 }],
      promotionCodes: ['FREESHIP'],
      deliveryAddress: { state: 'Lagos', area: 'Ikeja' },
      deliveryMethod: 'delivery',
    });
    assert.equal(big.body.deliveryFeeMinor, 0);
    assert.equal(big.body.delivery.baseFeeMinor, 300000);
    assert.equal(big.body.delivery.freeDeliveryPromotionId !== null, true);

    const small = await post('/api/v1/pricing/quote', {
      items: [{ variantId: v.scarce, quantity: 1 }],
      promotionCodes: ['FREESHIP'],
      deliveryAddress: { state: 'Lagos', area: 'Ikeja' },
      deliveryMethod: 'delivery',
    });
    assert.equal(small.body.deliveryFeeMinor, 300000);
  });

  it('422s unserviceable destinations and unoffered methods', async () => {
    const items = [{ variantId: v.scarce, quantity: 1 }];
    const unknown = await post('/api/v1/pricing/quote', { items, deliveryAddress: { state: 'Kano' }, deliveryMethod: 'delivery' });
    assert.equal(unknown.body.error.code, 'DELIVERY_UNAVAILABLE');
    const inactive = await post('/api/v1/pricing/quote', { items, deliveryAddress: { state: 'Oyo' }, deliveryMethod: 'delivery' });
    assert.equal(inactive.body.error.code, 'DELIVERY_UNAVAILABLE');
    const method = await post('/api/v1/pricing/quote', { items, deliveryAddress: { state: 'FCT' }, deliveryMethod: 'pickup' });
    assert.equal(method.status, 422);
    assert.equal(method.body.error.code, 'DELIVERY_METHOD_UNAVAILABLE');
    assert.equal((await post('/api/v1/pricing/quote', { items, deliveryMethod: 'delivery' })).status, 422);
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
    assert.deepEqual(Object.keys(by).sort(), ['delivery', 'pickup']);
    assert.equal(by.delivery.baseFeeMinor, 300000);
    assert.equal(by.delivery.feeMinor, 0);
    assert.equal(by.pickup.estimate, null);
    assert.match(by.delivery.estimate.earliestDate, /^\d{4}-\d{2}-\d{2}$/);
    // The zone says 1 to 2 days, so the window is one day wide.
    const day = 86_400_000;
    assert.equal((Date.parse(by.delivery.estimate.latestDate) - Date.parse(by.delivery.estimate.earliestDate)) / day, 1);
  });

  it('prices a state from the nationwide zone that lists it', async () => {
    const quoted = (address: Json) => post('/api/v1/delivery/quotes', { items: [{ variantId: v.scarce, quantity: 1 }], deliveryAddress: address });
    const kaduna = await quoted({ state: 'Kaduna' });
    assert.equal(kaduna.status, 200);
    assert.equal(kaduna.body.zone.name, 'Nationwide');
    assert.equal(kaduna.body.zone.scope, 'nationwide');
    const delivery = kaduna.body.options.find((o: Json) => o.method === 'delivery');
    assert.equal(delivery.baseFeeMinor, 700000);
    assert.equal((Date.parse(delivery.estimate.latestDate) - Date.parse(delivery.estimate.earliestDate)) / 86_400_000, 2, 'the nationwide zone says 2 to 4 days');
    // The checkout quote uses the same zone.
    const checkout = await post('/api/v1/pricing/quote', { items: [{ variantId: v.scarce, quantity: 1 }], deliveryAddress: { state: 'enugu' }, deliveryMethod: 'delivery' });
    assert.equal(checkout.body.deliveryFeeMinor, 700000);
  });

  it('a state zone always beats the nationwide zone for its own state', async () => {
    const quoted = async (address: Json) => (await post('/api/v1/delivery/quotes', { items: [{ variantId: v.scarce, quantity: 1 }], deliveryAddress: address })).body.zone.name;
    assert.equal(await quoted({ state: 'FCT' }), 'Abuja', 'FCT is listed in the nationwide zone but has its own');
    assert.equal(await quoted({ state: 'Lagos', area: 'Ikeja' }), 'Lagos Mainland & Island');
    assert.equal(await quoted({ state: 'Rivers', area: 'Port Harcourt' }), 'Port Harcourt', 'the area zone wins in its area');
    assert.equal(await quoted({ state: 'RIVERS', area: '  port   HARCOURT ' }), 'Port Harcourt', 'state and area match regardless of case and spacing');
    assert.equal(await quoted({ state: 'Kaduna' }), 'Nationwide', 'a state with no zone of its own is priced nationwide');
    assert.equal(await quoted({ state: 'Rivers', area: 'Bonny' }), 'Nationwide', 'an area none of the state zones list falls back to the nationwide zone');
    const noArea = await post('/api/v1/delivery/quotes', { items: [{ variantId: v.scarce, quantity: 1 }], deliveryAddress: { state: 'Rivers' } });
    assert.equal(noArea.body.zone, null, 'with no area given the area is required');
    assert.equal(noArea.body.deliveryRange.minFeeMinor, 450000);
  });

  it('shows a price range and the areas when a state has only area zones and no area is chosen', async () => {
    const quoted = (address: Json) => post('/api/v1/delivery/quotes', { items: [{ variantId: v.scarce, quantity: 1 }], deliveryAddress: address });
    const res = await quoted({ state: 'Ogun' });
    assert.equal(res.status, 200);
    assert.equal(res.body.zone, null);
    assert.deepEqual(res.body.deliveryRange, { minFeeMinor: 200000, maxFeeMinor: 500000 });
    assert.deepEqual(res.body.areaPrices.map((z: Json) => [z.zoneName, z.feeMinor, z.areas]), [['Ibadan North', 200000, ['Abeokuta']], ['Ogun Far', 500000, ['Ijebu']]]);
    assert.equal((await quoted({ state: 'Ogun', area: 'Nowhere' })).body.deliveryRange.maxFeeMinor, 500000, 'no nationwide zone covers Ogun, so an unlisted area still shows the range');
    assert.equal((await quoted({ state: 'Ogun', area: 'Ijebu' })).body.zone.name, 'Ogun Far');
  });

  it('does not serve states from a retired nationwide zone', async () => {
    const res = await post('/api/v1/delivery/quotes', { items: [{ variantId: v.scarce, quantity: 1 }], deliveryAddress: { state: 'Kwara' } });
    assert.equal(res.body.error.code, 'DELIVERY_UNAVAILABLE');
  });

  it('delivery quotes validate the cart and destination', async () => {
    assert.equal((await post('/api/v1/delivery/quotes', { items: [{ variantId: v.wig, quantity: 1 }] })).status, 422);
    assert.equal((await post('/api/v1/delivery/quotes', { items: [{ variantId: v.draft, quantity: 1 }], deliveryAddress: lagos })).status, 422);
    const none = await post('/api/v1/delivery/quotes', { items: [{ variantId: v.wig, quantity: 1 }], deliveryAddress: { state: 'Kano' } });
    assert.equal(none.body.error.code, 'DELIVERY_UNAVAILABLE');
  });
});
