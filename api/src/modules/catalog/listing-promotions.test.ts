import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { collections, productCollections, promotionCodes, promotionHolds, promotions } from '../../db/schema/index.js';
import { makeProduct, paidOrder } from '../../testing/catalog-fixtures.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { listProducts, type ProductCard } from './listing.js';

describe('product tile promotion chips', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  const ids: Record<string, { id: string; variantIds: Record<string, string> }> = {};

  const cards = async () => {
    const page = await listProducts(t.db, { filters: { options: {} }, sort: 'newest', limit: 50, withTotal: false });
    return new Map(page.data.map((c) => [c.slug, c]));
  };
  const chip = async (slug: string) => (await cards()).get(slug)!.badges.find((b) => b.label.endsWith('off'))?.label ?? null;
  const promo = async (name: string, kind: 'percentage' | 'fixed_amount' | 'buy_x_get_y' | 'free_delivery', configuration: object, extra: Partial<typeof promotions.$inferInsert> = {}) =>
    (await t.db.insert(promotions).values({ name, kind, configuration, status: 'active', ...extra }).returning())[0]!;

  before(async () => {
    t = await createTestDatabase();
    ids['wig'] = await makeProduct(t, 'wig', { options: [{ name: 'length', values: [{ key: '14' }, { key: '20' }] }], variants: [{ sku: 'W1', pick: { length: '14' }, price: 20_000_000 }, { sku: 'W2', pick: { length: '20' }, price: 30_000_000 }] });
    ids['bonnet'] = await makeProduct(t, 'bonnet', { variants: [{ sku: 'B1', pick: {}, price: 1_000_000 }] });
  });
  beforeEach(async () => {
    await t.db.delete(promotionHolds);
    await t.db.delete(promotionCodes);
    await t.db.delete(promotions);
  });
  after(async () => {
    await t?.destroy();
  });

  it('shows no chip when there is no promotion', async () => {
    assert.equal(await chip('wig'), null);
  });

  it('shows a percentage chip and leaves the price alone', async () => {
    await promo('Ten off', 'percentage', { version: 1, percent: 10 });
    const wig = (await cards()).get('wig')!;
    assert.equal(wig.badges.find((b) => b.label.endsWith('off'))?.label, '10% off');
    assert.equal(wig.badges.find((b) => b.label === '10% off')?.kind, 'sale');
    assert.equal(wig.price.minAmountMinor, 20_000_000, 'the list price is unchanged');
    assert.equal(wig.price.maxAmountMinor, 30_000_000);
    assert.equal(wig.price.compareAtMinor, null, 'the variant itself is not marked down');
    assert.equal(wig.price.saleMinAmountMinor, 18_000_000, 'the price after the promotion, for the tile to show with the list price struck through');
  });

  it('shows the naira amount for a fixed discount', async () => {
    await promo('5k off', 'fixed_amount', { version: 1, amountMinor: 500_000 });
    assert.equal(await chip('wig'), '₦5,000 off');
  });

  it('reports the real percentage when a cap limits the discount', async () => {
    await promo('Capped', 'percentage', { version: 1, percent: 50, maxDiscountMinor: 2_000_000 });
    assert.equal(await chip('wig'), '10% off'); // 20,000 of 200,000 on the cheapest variant
  });

  it('only marks products inside the promotion scope', async () => {
    await promo('Wigs only', 'percentage', { version: 1, percent: 15 }, { scope: { include: { productIds: [ids['wig']!.id] } } });
    assert.equal(await chip('wig'), '15% off');
    assert.equal(await chip('bonnet'), null);
  });

  it('respects collection scope and product exclusions', async () => {
    const [col] = await t.db.insert(collections).values({ slug: 'sale-col', name: 'Sale' }).returning();
    await t.db.insert(productCollections).values({ productId: ids['bonnet']!.id, collectionId: col!.id });
    await promo('Collection', 'percentage', { version: 1, percent: 20 }, { scope: { include: { collectionIds: [col!.id] } } });
    assert.equal(await chip('bonnet'), '20% off');
    assert.equal(await chip('wig'), null);
    await t.db.delete(promotions);
    await promo('All but bonnet', 'percentage', { version: 1, percent: 20 }, { scope: { include: { allProducts: true }, excludeProductIds: [ids['bonnet']!.id] } });
    assert.equal(await chip('wig'), '20% off');
    assert.equal(await chip('bonnet'), null);
  });

  it('hides the chip when one unit does not reach the minimum spend', async () => {
    await promo('Over 150k', 'percentage', { version: 1, percent: 10 }, { minimumSubtotalMinor: 15_000_000 });
    assert.equal(await chip('wig'), '10% off');
    assert.equal(await chip('bonnet'), null);
  });

  it('ignores promotions that need a code, a window that is not open, or are not active', async () => {
    const coded = await promo('Coded', 'percentage', { version: 1, percent: 10 });
    await t.db.insert(promotionCodes).values({ promotionId: coded.id, code: 'SAVE' });
    await promo('Expired', 'percentage', { version: 1, percent: 10 }, { endsAt: new Date(Date.now() - 86_400_000) });
    await promo('Not yet', 'percentage', { version: 1, percent: 10 }, { startsAt: new Date(Date.now() + 86_400_000) });
    await promo('Draft', 'percentage', { version: 1, percent: 10 }, { status: 'draft' });
    await promo('Paused', 'percentage', { version: 1, percent: 10 }, { status: 'inactive' });
    assert.equal(await chip('wig'), null);
  });

  it('ignores offers that depend on who the buyer is', async () => {
    await promo('First order', 'percentage', { version: 1, percent: 10 }, { firstOrderOnly: true });
    await promo('Once each', 'percentage', { version: 1, percent: 10 }, { perCustomerLimit: 1 });
    assert.equal(await chip('wig'), null);
  });

  it('ignores promotions that take nothing off a single unit', async () => {
    await promo('Free delivery', 'free_delivery', { version: 1 });
    await promo('Buy 2 get 1', 'buy_x_get_y', { version: 1, buy: 2, get: 1 });
    assert.equal(await chip('wig'), null);
  });

  it('stops showing the chip once the total usage limit is used up', async () => {
    const limited = await promo('First ten', 'percentage', { version: 1, percent: 10 }, { totalUsageLimit: 5, usageCount: 4 });
    assert.equal(await chip('wig'), '10% off', 'one use left');
    await t.db.update(promotions).set({ usageCount: 5 }).where(eq(promotions.id, limited.id));
    assert.equal(await chip('wig'), null, 'all uses taken');
  });

  it('counts an open checkout hold as a used slot, and brings the chip back when it is released', async () => {
    const limited = await promo('Last one', 'percentage', { version: 1, percent: 10 }, { totalUsageLimit: 1 });
    assert.equal(await chip('wig'), '10% off');
    const order = await paidOrder(t, [{ productId: ids['wig']!.id, variantId: ids['wig']!.variantIds['W1']!, quantity: 1 }], { status: 'pending_payment', paymentStatus: 'pending' });
    await t.db.insert(promotionHolds).values({ promotionId: limited.id, orderId: order.id });
    assert.equal(await chip('wig'), null);
    await t.db.delete(promotionHolds);
    assert.equal(await chip('wig'), '10% off');
  });

  it('keeps a promotion with no usage limit showing however often it has been used', async () => {
    await promo('Unlimited', 'percentage', { version: 1, percent: 10 }, { usageCount: 10_000 });
    assert.equal(await chip('wig'), '10% off');
  });

  it('orders the chip after a staff badge and before the compare-at sale badge', async () => {
    const tagged = await makeProduct(t, 'tagged', { badge: 'Bestseller', variants: [{ sku: 'T1', pick: {}, price: 10_000_000, compareAt: 12_500_000 }] });
    await promo('Ten off', 'percentage', { version: 1, percent: 10 });
    const labels = (await cards()).get('tagged')!.badges.map((b: ProductCard['badges'][number]) => b.label);
    assert.deepEqual(labels.slice(0, 3), ['Bestseller', '10% off', '-20%']);
    assert.ok(tagged.id);
  });
});
