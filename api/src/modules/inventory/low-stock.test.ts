import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { inventory, notificationOutbox, productVariants, products } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { processOutbox } from '../notifications/process.js';
import type { Message, Sender, Senders } from '../notifications/senders.js';
import { findLowStock, queueLowStockAlert } from './low-stock.js';

class Capture implements Sender {
  readonly name = 'capture';
  sent: Message[] = [];
  async send(m: Message) {
    this.sent.push(m);
    return {};
  }
}

describe('low-stock alerts', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  const ids: Record<string, string> = {};
  const NOW = new Date('2026-10-20T08:00:00Z');

  const variant = async (key: string, over: { onHand: number; reserved?: number; threshold: number | null; active?: boolean; status?: 'active' | 'archived' }) => {
    const [p] = await t.db.insert(products).values({ slug: `ls-${key}`, title: `Wig ${key}`, status: over.status ?? 'active' }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: `LS-${key}`, optionSignature: {}, priceMinor: 100000, active: over.active ?? true }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: over.onHand, reservedQuantity: over.reserved ?? 0, lowStockThreshold: over.threshold });
    ids[key] = v!.id;
  };

  before(async () => {
    t = await createTestDatabase();
    await variant('low', { onHand: 3, threshold: 5 });
    await variant('reserved', { onHand: 8, reserved: 4, threshold: 5 }); // 4 available: low, because reserved stock is not for sale
    await variant('fine', { onHand: 50, threshold: 5 });
    await variant('nolimit', { onHand: 0, threshold: null }); // no warning level set: never alerted
    await variant('hidden', { onHand: 1, threshold: 5, active: false });
    await variant('archived', { onHand: 1, threshold: 5, status: 'archived' });
  });
  after(async () => {
    await t?.destroy();
  });

  it('lists live variants at or under their warning level, counting only what is available to sell', async () => {
    const { items, total } = await findLowStock(t.db);
    assert.equal(total, 2);
    assert.deepEqual(items.map((i) => [i.sku, i.available, i.threshold]), [['LS-low', 3, 5], ['LS-reserved', 4, 5]], 'fewest left first');
  });

  it('queues one operations alert, then waits a day before the next, and emails the operations address', async () => {
    assert.equal(await queueLowStockAlert(t.db, NOW), 2);
    assert.equal(await queueLowStockAlert(t.db, new Date(NOW.getTime() + 3 * 3600_000)), 0, 'not again within a day');
    const rows = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.eventType, 'stock.low'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.channel, 'internal');

    const email = new Capture();
    const senders: Senders = { sms: new Capture(), email };
    await processOutbox(t.db, senders, createLogger('error'), new Date(NOW.getTime() + 1000), { opsEmail: 'ops@example.com' });
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0]!.to, 'ops@example.com');
    assert.match(email.sent[0]!.subject!, /Low stock: 2 items need restocking/);
    assert.match(email.sent[0]!.text, /Wig low \(LS-low\): 3 left, warn at 5/);

    assert.equal(await queueLowStockAlert(t.db, new Date(NOW.getTime() + 25 * 3600_000)), 2, 'a reminder the next day while still low');
  });

  it('sends nothing when nothing is low', async () => {
    await t.db.update(inventory).set({ onHandQuantity: 100 }).where(eq(inventory.variantId, ids.low!));
    await t.db.update(inventory).set({ onHandQuantity: 100 }).where(eq(inventory.variantId, ids.reserved!));
    assert.equal(await queueLowStockAlert(t.db, new Date(NOW.getTime() + 72 * 3600_000)), 0);
  });
});
