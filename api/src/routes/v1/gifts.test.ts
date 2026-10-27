import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { deliveryZones, inventory, orderItems, productVariants, products, promotionCodes, promotions, stockReservations } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { adminTestEnv } from '../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeProvider } from '../../testing/fake-provider.js';

type Json = Record<string, any>;

describe('free gift with purchase', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  const v: Record<string, string> = {};
  let n = 0;

  async function variant(key: string, price: number, stock: number) {
    const [p] = await t.db.insert(products).values({ slug: key, title: `Title ${key}`, status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [pv] = await t.db.insert(productVariants).values({ productId: p!.id, sku: key, optionSignature: {}, priceMinor: price }).returning();
    await t.db.insert(inventory).values({ variantId: pv!.id, onHandQuantity: stock });
    v[key] = pv!.id;
  }
  const quote = async (items: { variantId: string; quantity: number }[], codes: string[] = ['GIFTME']) => {
    const res = await api.inject({ method: 'POST', url: '/api/v1/pricing/quote', payload: { items, promotionCodes: codes, deliveryAddress: { state: 'Lagos', area: 'Lekki' }, deliveryMethod: 'next_day' } });
    return { status: res.statusCode, body: res.result as Json };
  };
  const checkout = (items: { variantId: string; quantity: number }[]) =>
    api.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { items, promotionCodes: ['GIFTME'], contact: { phone: '+2348455100001' }, deliveryAddress: { recipientName: 'Ada', addressLine1: '1 Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod: 'card', termsAccepted: true },
      headers: { 'idempotency-key': `gift-${++n}-abcdefgh-0123456789abcdefghijklmnopqrstuvwxyz` },
    });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    await variant('wig', 200_000, 10);
    await variant('bonnet', 20_000, 5);
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 100_000 });
    const [promo] = await t.db.insert(promotions).values({ name: 'Free bonnet', kind: 'free_gift', configuration: { version: 1, variantId: v.bonnet, quantity: 1 }, status: 'active', minimumSubtotalMinor: 150_000 }).returning();
    await t.db.insert(promotionCodes).values({ promotionId: promo!.id, code: 'GIFTME' });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('adds a free line that costs nothing, and counts its value as a saving', async () => {
    const { status, body } = await quote([{ variantId: v.wig!, quantity: 1 }]);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.lines.length, 2);
    const gift = body.lines.find((l: Json) => l.gift);
    assert.deepEqual([gift.title, gift.quantity, gift.unitPriceMinor, gift.lineTotalMinor, gift.discountMinor], ['Title bonnet', 1, 20_000, 0, 20_000]);
    assert.equal(gift.gift.promotionId, body.promotions.applied[0].promotionId);
    assert.deepEqual([body.subtotalMinor, body.discountMinor], [220_000, 20_000]);
    assert.equal(body.totalMinor, 200_000 + 100_000, 'the wig and delivery; the gift is free');
    assert.deepEqual(body.promotions.applied.map((a: Json) => [a.kind, a.code, a.discountMinor]), [['free_gift', 'GIFTME', 20_000]]);
    assert.equal(body.lines.find((l: Json) => !l.gift).gift, null);
  });

  it('is left out under the minimum spend, and without the code', async () => {
    const small = await quote([{ variantId: v.bonnet!, quantity: 1 }]);
    assert.equal(small.body.lines.length, 1);
    assert.equal(small.body.promotions.rejectedCodes[0].reason, 'MIN_SPEND_NOT_MET');
    assert.equal((await quote([{ variantId: v.wig!, quantity: 1 }], [])).body.lines.length, 1);
  });

  it('does not give stock the customer is already buying, and drops a gift that has run out, with a warning', async () => {
    // 5 bonnets in stock: buying all 5 leaves none to give.
    const all = await quote([{ variantId: v.wig!, quantity: 1 }, { variantId: v.bonnet!, quantity: 5 }]);
    assert.equal(all.body.lines.some((l: Json) => l.gift), false);
    assert.deepEqual(all.body.warnings.filter((w: Json) => w.code === 'GIFT_UNAVAILABLE').map((w: Json) => w.variantId), [v.bonnet]);
    assert.equal(all.body.promotions.applied.length, 0, 'a gift that cannot be given is not counted as applied');
    const four = await quote([{ variantId: v.wig!, quantity: 1 }, { variantId: v.bonnet!, quantity: 4 }]);
    assert.equal(four.body.lines.filter((l: Json) => l.gift).length, 1, 'one is left to give');
  });

  it('puts the gift on the order at no charge and holds its stock', async () => {
    const res = await checkout([{ variantId: v.wig!, quantity: 1 }]);
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    const body = res.result as Json;
    assert.equal(body.amountMinor, 300_000, 'the customer pays for the wig and delivery only');
    const items = await t.db.select().from(orderItems).where(eq(orderItems.orderId, body.orderId));
    assert.deepEqual(items.map((i) => [i.skuSnapshot, i.quantity, i.unitPriceMinor, i.discountMinor, i.lineTotalMinor]).sort(), [['bonnet', 1, 20_000, 20_000, 0], ['wig', 1, 200_000, 0, 200_000]].sort());
    const held = await t.db.select().from(stockReservations).where(eq(stockReservations.orderId, body.orderId));
    assert.deepEqual(held.map((h) => [h.variantId, h.quantity]).sort(), [[v.bonnet, 1], [v.wig, 1]].sort(), 'the gift is reserved like anything else');
    const [stock] = await t.db.select().from(inventory).where(eq(inventory.variantId, v.bonnet!));
    assert.equal(stock!.reservedQuantity, 1);
  });
});
