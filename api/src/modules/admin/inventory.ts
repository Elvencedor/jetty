import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { inventory, inventoryMovements, productVariants } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { conflict, notFound } from '../../lib/errors.js';
import { likeContains } from '../../lib/sql.js';

export const STOCK_REASONS = ['restock', 'correction', 'damaged', 'returned', 'stock_count'] as const;

export type StockChange = {
  /** `adjust` adds a signed quantity; `set` makes on-hand equal the counted figure. */
  mode: 'adjust' | 'set';
  quantity: number;
  reason: (typeof STOCK_REASONS)[number];
  reference?: string | undefined;
  lowStockThreshold?: number | null | undefined;
};

/**
 * Changes on-hand stock and appends to the movement ledger in one transaction;
 * history is never overwritten. Stock cannot drop below what open orders have reserved.
 */
export async function changeStock(db: Db, adminId: string, variantId: string, change: StockChange) {
  return db.transaction(async (tx) => {
    const [variant] = await tx.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants).where(eq(productVariants.id, variantId));
    if (!variant) throw notFound('Variant not found.');
    await tx.insert(inventory).values({ variantId }).onConflictDoNothing();
    const [row] = await tx.select().from(inventory).where(eq(inventory.variantId, variantId)).for('update');
    const current = row!;

    const target = change.mode === 'set' ? change.quantity : current.onHandQuantity + change.quantity;
    if (target < current.reservedQuantity) {
      throw conflict('STOCK_BELOW_RESERVED', `${current.reservedQuantity} units are reserved by open orders; on-hand cannot go below that.`, [{ variantId, reserved: current.reservedQuantity }]);
    }
    const delta = target - current.onHandQuantity;
    const [after] = await tx
      .update(inventory)
      .set({ onHandQuantity: target, ...(change.lowStockThreshold !== undefined ? { lowStockThreshold: change.lowStockThreshold } : {}) })
      .where(eq(inventory.variantId, variantId))
      .returning();
    if (delta !== 0) await tx.insert(inventoryMovements).values({ variantId, quantityDelta: delta, reason: change.reason, adminUserId: adminId, reference: change.reference ?? null });
    return {
      sku: variant.sku,
      before: { onHand: current.onHandQuantity, lowStockThreshold: current.lowStockThreshold },
      after: { variantId, onHand: after!.onHandQuantity, reserved: after!.reservedQuantity, available: after!.onHandQuantity - after!.reservedQuantity, lowStockThreshold: after!.lowStockThreshold },
      delta,
    };
  });
}

export async function listInventory(db: Db, input: { q?: string | undefined; filter?: 'low' | 'out' | undefined; limit: number; cursor?: string | undefined }) {
  const where = [sql`v.active`];
  if (input.q) {
    const like = likeContains(input.q);
    where.push(sql`(v.sku ilike ${like} or p.title ilike ${like})`);
  }
  if (input.filter === 'out') where.push(sql`coalesce(i.on_hand_quantity - i.reserved_quantity, 0) <= 0`);
  if (input.filter === 'low') where.push(sql`i.low_stock_threshold is not null and i.on_hand_quantity - i.reserved_quantity <= i.low_stock_threshold`);
  let after = sql``;
  if (input.cursor) {
    const [sku, id] = decodeCursor(input.cursor, 'admin-inventory', 2);
    after = sql`and (upper(v.sku), v.id) > (${sku}::text, ${id}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select v.id, v.sku, v.option_signature, p.id as product_id, p.title, p.status,
      coalesce(i.on_hand_quantity, 0) as on_hand, coalesce(i.reserved_quantity, 0) as reserved, i.low_stock_threshold,
      upper(v.sku) as cur_sku
    from product_variants v join products p on p.id = v.product_id left join inventory i on i.variant_id = v.id
    where ${sql.join(where, sql` and `)} ${after}
    order by upper(v.sku), v.id limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => ({
      variantId: r.id as string,
      sku: r.sku as string,
      productId: r.product_id as string,
      productTitle: r.title as string,
      productStatus: r.status as string,
      optionValues: r.option_signature,
      onHand: r.on_hand as number,
      reserved: r.reserved as number,
      available: (r.on_hand as number) - (r.reserved as number),
      lowStockThreshold: (r.low_stock_threshold as number | null) ?? null,
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: 'admin-inventory', values: [String(last.cur_sku), String(last.id)] }) : null },
  };
}
