import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';

export type LowStockItem = { variantId: string; sku: string; title: string; available: number; threshold: number };

/** How long after a low-stock alert before the next one: a daily reminder, not a message per sale. */
export const LOW_STOCK_REPEAT_HOURS = 24;
const MAX_ITEMS = 25;

/** Live variants of products that are not archived whose available stock (on hand minus reserved) is at or under their warning level. */
export async function findLowStock(db: Db): Promise<{ items: LowStockItem[]; total: number }> {
  const rows = (await db.execute(sql`
    select v.id as variant_id, v.sku, p.title, greatest(i.on_hand_quantity - i.reserved_quantity, 0)::int as available, i.low_stock_threshold as threshold,
      count(*) over ()::int as total
    from inventory i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id
    where v.active and p.status <> 'archived' and i.low_stock_threshold is not null and i.on_hand_quantity - i.reserved_quantity <= i.low_stock_threshold
    order by available asc, p.title asc limit ${MAX_ITEMS}`)) as unknown as { variant_id: string; sku: string; title: string; available: number; threshold: number; total: number }[];
  return { total: rows[0]?.total ?? 0, items: rows.map((r) => ({ variantId: r.variant_id, sku: r.sku, title: r.title, available: r.available, threshold: r.threshold })) };
}

/**
 * Queues one operations alert listing what is low, unless one was queued in the last day or nothing is low. The alert
 * rides the outbox like every other message, so it is retried and emailed to the operations address when one is set.
 * Returns how many items it listed (0 when it sent nothing).
 */
export async function queueLowStockAlert(db: Db, now: Date = new Date()): Promise<number> {
  const { items, total } = await findLowStock(db);
  if (items.length === 0) return 0;
  const [recent] = (await db.execute(sql`
    select 1 as found from notification_outbox where event_type = 'stock.low' and created_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${LOW_STOCK_REPEAT_HOURS}) limit 1`)) as unknown as { found: number }[];
  if (recent) return 0;
  await db.execute(sql`
    insert into notification_outbox (event_type, recipient, channel, payload, next_attempt_at, created_at)
    values ('stock.low', 'operations', 'internal', ${JSON.stringify({ total, items })}::jsonb, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`);
  return items.length;
}
