import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { inventory, orders, productVariants, products, stockReservations } from '../../db/schema/index.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { InsufficientStockError, releaseExpiredReservations, reserveStock } from './reservations.js';

describe('stock reservations', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let seq = 0;

  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });

  async function newVariant(onHand: number) {
    const n = ++seq;
    const [product] = await t.db.insert(products).values({ slug: `p-${n}`, title: `P${n}` }).returning();
    const [variant] = await t.db
      .insert(productVariants)
      .values({ productId: product!.id, sku: `SKU-${n}`, optionSignature: {}, priceMinor: 1000 })
      .returning();
    await t.db.insert(inventory).values({ variantId: variant!.id, onHandQuantity: onHand });
    return variant!.id;
  }

  async function newOrder() {
    const n = ++seq;
    const [order] = await t.db
      .insert(orders)
      .values({
        orderNumber: `JH-TEST-${n}`,
        email: 'buyer@example.com',
        phoneE164: '+2348012345678',
        subtotalMinor: 1000,
        totalMinor: 1000,
        deliveryAddressSnapshot: {},
        deliveryMethod: 'same_day',
        termsAcceptedAt: new Date(),
      })
      .returning();
    return order!.id;
  }

  const stock = async (variantId: string) =>
    (await t.db.select().from(inventory).where(eq(inventory.variantId, variantId)))[0]!;

  it('lets only one of two concurrent checkouts reserve the last unit', async () => {
    const variantId = await newVariant(1);
    const [a, b] = await Promise.all([newOrder(), newOrder()]);
    const expiresAt = new Date(Date.now() + 60_000);

    const results = await Promise.allSettled([
      reserveStock(t.db, { orderId: a!, lines: [{ variantId, quantity: 1 }], expiresAt }),
      reserveStock(t.db, { orderId: b!, lines: [{ variantId, quantity: 1 }], expiresAt }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(failed.reason instanceof InsufficientStockError);
    assert.equal((await stock(variantId)).reservedQuantity, 1);
  });

  it('never oversells under heavy contention', async () => {
    const variantId = await newVariant(5);
    const orderIds = await Promise.all(Array.from({ length: 20 }, newOrder));
    const expiresAt = new Date(Date.now() + 60_000);

    const results = await Promise.allSettled(
      orderIds.map((orderId) => reserveStock(t.db, { orderId, lines: [{ variantId, quantity: 1 }], expiresAt })),
    );

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
    assert.equal((await stock(variantId)).reservedQuantity, 5);
  });

  it('rolls back every line when one line is short', async () => {
    const plenty = await newVariant(10);
    const scarce = await newVariant(1);
    const orderId = await newOrder();

    await assert.rejects(
      reserveStock(t.db, {
        orderId,
        lines: [
          { variantId: plenty, quantity: 2 },
          { variantId: scarce, quantity: 2 },
        ],
        expiresAt: new Date(Date.now() + 60_000),
      }),
      InsufficientStockError,
    );

    assert.equal((await stock(plenty)).reservedQuantity, 0);
    assert.equal((await t.db.select().from(stockReservations).where(eq(stockReservations.orderId, orderId))).length, 0);
  });

  it('releases an expired reservation exactly once, even with concurrent workers', async () => {
    const variantId = await newVariant(3);
    const orderId = await newOrder();
    await reserveStock(t.db, { orderId, lines: [{ variantId, quantity: 2 }], expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await stock(variantId)).reservedQuantity, 2);

    const counts = await Promise.all([releaseExpiredReservations(t.db), releaseExpiredReservations(t.db)]);

    assert.equal(counts[0]! + counts[1]!, 1);
    assert.equal((await stock(variantId)).reservedQuantity, 0);
    assert.equal(await releaseExpiredReservations(t.db), 0);
  });

  it('does not release reservations that are still valid', async () => {
    const variantId = await newVariant(2);
    const orderId = await newOrder();
    await reserveStock(t.db, { orderId, lines: [{ variantId, quantity: 1 }], expiresAt: new Date(Date.now() + 60_000) });

    await releaseExpiredReservations(t.db);

    assert.equal((await stock(variantId)).reservedQuantity, 1);
  });
});
