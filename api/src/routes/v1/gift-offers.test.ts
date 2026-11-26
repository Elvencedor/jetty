import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { collections, inventory, productCollections, productVariants, products, promotionCodes, promotions } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { priceCart } from '../../modules/pricing/cart.js';
import { createServer } from '../../server.js';
import { adminTestEnv } from '../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';

type Json = Record<string, any>;

describe('free gift offers on the quote', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const v: Record<string, string> = {};
  const p: Record<string, string> = {};
  let bobs = '';

  async function variant(key: string, price: number, stock: number) {
    const [product] = await t.db.insert(products).values({ slug: key, title: `Title ${key}`, status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: product!.id, sku: key, optionSignature: {}, priceMinor: price }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: stock });
    v[key] = pv!.id;
    p[key] = product!.id;
  }
  const gift = async (name: string, extra: Partial<typeof promotions.$inferInsert> = {}, variantKey = 'bonnet') =>
    (await t.db.insert(promotions).values({ name, kind: 'free_gift', configuration: { version: 1, variantId: v[variantKey], quantity: 1 }, status: 'active', ...extra }).returning())[0]!;
  const offers = async (items: { variantId: string; quantity: number }[] = [{ variantId: v.wig!, quantity: 1 }], codes: string[] = []) => {
    const res = await api.inject({ method: 'POST', url: '/api/v1/pricing/quote', payload: { items, promotionCodes: codes } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.result));
    return (res.result as Json).giftOffers as Json[];
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await api.initialize();
    await variant('wig', 100_000, 50);
    await variant('bob', 60_000, 50);
    await variant('bonnet', 20_000, 50);
    await variant('scarf', 5_000, 3);
    await variant('gone', 5_000, 0);
    const [col] = await t.db.insert(collections).values({ slug: 'bob-wigs', name: 'Bob wigs' }).returning();
    bobs = col!.id;
    await t.db.insert(productCollections).values({ productId: p.bob!, collectionId: bobs });
  });
  beforeEach(async () => {
    await t.db.delete(promotionCodes);
    await t.db.delete(promotions);
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('says how much more to spend, then reports the gift unlocked once it is in the order', async () => {
    const promo = await gift('Bonnet over 2.5k', { minimumSubtotalMinor: 250_000 });
    const [locked] = await offers();
    assert.deepEqual([locked!.promotionId, locked!.status, locked!.needs], [promo.id, 'locked', { signIn: false, qualifyingItem: false, spendMinor: 150_000 }]);
    assert.deepEqual([locked!.gift.title, locked!.gift.valueMinor, locked!.eligibleSubtotalMinor, locked!.minimumSubtotalMinor], ['Title bonnet', 20_000, 100_000, 250_000]);
    assert.deepEqual([locked!.leftCount, locked!.endsAt, locked!.qualifying.allProducts], [null, null, true]);

    const [unlocked] = await offers([{ variantId: v.wig!, quantity: 3 }]);
    assert.deepEqual([unlocked!.status, unlocked!.needs.spendMinor], ['unlocked', 0]);
  });

  it('names what to add when nothing in the bag is covered', async () => {
    await gift('With a bob', { scope: { include: { collectionIds: [bobs] } } });
    const [offer] = await offers();
    assert.equal(offer!.needs.qualifyingItem, true);
    assert.deepEqual(offer!.qualifying, { allProducts: false, collections: [{ slug: 'bob-wigs', name: 'Bob wigs' }], products: [] });
    assert.equal((await offers([{ variantId: v.bob!, quantity: 1 }]))[0]!.status, 'unlocked');
  });

  it('never reveals a gift that needs a code, until the shopper enters it', async () => {
    const promo = await gift('Secret', { minimumSubtotalMinor: 250_000 });
    await t.db.insert(promotionCodes).values({ promotionId: promo.id, code: 'SECRET' });
    assert.deepEqual(await offers(), []);
    assert.equal((await offers(undefined, ['SECRET']))[0]!.needs.spendMinor, 150_000);
  });

  it('tells a guest to sign in for an offer limited per customer', async () => {
    await gift('Welcome', { firstOrderOnly: true });
    const [offer] = await offers();
    assert.deepEqual([offer!.status, offer!.needs.signIn, offer!.firstOrderOnly], ['locked', true, true]);
  });

  it('mentions scarcity and the end only when they are real', async () => {
    const endsAt = new Date(Date.now() + 3_600_000);
    await gift('Few', { minimumSubtotalMinor: 250_000, totalUsageLimit: 10, usageCount: 8, endsAt });
    await gift('Plenty', { minimumSubtotalMinor: 300_000, totalUsageLimit: 100 });
    await gift('Low stock', { minimumSubtotalMinor: 350_000 }, 'scarf');
    const by = Object.fromEntries((await offers()).map((o) => [o.name, o]));
    assert.deepEqual([by.Few!.leftCount, by.Few!.endsAt], [2, endsAt.toISOString()]);
    assert.equal(by.Plenty!.leftCount, null);
    assert.equal(by['Low stock']!.leftCount, 3);
  });

  it('leaves out gifts that cannot be had, ended offers and used-up ones', async () => {
    await gift('Out of stock', { minimumSubtotalMinor: 250_000 }, 'gone');
    await gift('Ended', { minimumSubtotalMinor: 250_000, endsAt: new Date('2026-01-02') });
    await gift('Used up', { minimumSubtotalMinor: 250_000, totalUsageLimit: 1, usageCount: 1 });
    const draft = await gift('Draft', { minimumSubtotalMinor: 250_000 });
    await t.db.update(promotions).set({ status: 'draft' }).where(eq(promotions.id, draft.id));
    // All three scarves are in the bag, so none is left to give.
    await gift('Taken', { minimumSubtotalMinor: 250_000 }, 'scarf');
    assert.deepEqual(await offers([{ variantId: v.scarf!, quantity: 3 }]), []);
  });

  it('puts earned gifts first, then the closest to being earned', async () => {
    await gift('Far', { minimumSubtotalMinor: 900_000 });
    await gift('Needs a bob', { scope: { include: { collectionIds: [bobs] } } });
    await gift('Near', { minimumSubtotalMinor: 150_000 });
    await gift('Earned', { minimumSubtotalMinor: 50_000 });
    assert.deepEqual((await offers()).map((o) => o.name), ['Earned', 'Near', 'Far', 'Needs a bob']);
  });

  it('is only worked out for quotes', async () => {
    await gift('Any', { minimumSubtotalMinor: 250_000 });
    const priced = await priceCart(t.db, { items: [{ variantId: v.wig!, quantity: 1 }], promotionCodes: [] });
    assert.deepEqual(priced.giftOffers, []);
  });
});
