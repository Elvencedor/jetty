import { releasePromotionHolds } from '../promotions/holds.js';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { inventory, orders, orderStatusEvents, paymentAttempts, stockReservations } from '../../db/schema/index.js';

export class InsufficientStockError extends Error {
  constructor(
    readonly variantId: string,
    readonly requested: number,
  ) {
    super(`Insufficient stock for variant ${variantId}`);
  }
}

export type ReservationLine = { variantId: string; quantity: number };

/**
 * Reserves stock atomically. The conditional UPDATE takes the row lock and
 * re-checks availability, so concurrent checkouts cannot oversell. Lines are
 * processed in variant order so concurrent multi-line orders cannot deadlock.
 * Throws InsufficientStockError and rolls back every line if any is short.
 */
export async function reserveStock(
  db: Db,
  input: { orderId: string; lines: ReservationLine[]; expiresAt: Date },
): Promise<void> {
  await db.transaction((tx) => reserveStockInTx(tx, input));
}

/** Same as reserveStock but joins the caller's transaction, e.g. so checkout creates the order and reservation atomically. */
export async function reserveStockInTx(
  tx: Tx,
  input: { orderId: string; lines: ReservationLine[]; expiresAt: Date },
): Promise<void> {
  const lines = mergeLines(input.lines);
  for (const line of lines) {
    const updated = await tx
      .update(inventory)
      .set({ reservedQuantity: sql`${inventory.reservedQuantity} + ${line.quantity}` })
      .where(
        and(
          eq(inventory.variantId, line.variantId),
          sql`${inventory.onHandQuantity} - ${inventory.reservedQuantity} >= ${line.quantity}`,
        ),
      )
      .returning({ variantId: inventory.variantId });
    if (updated.length === 0) throw new InsufficientStockError(line.variantId, line.quantity);

    await tx.insert(stockReservations).values({
      orderId: input.orderId,
      variantId: line.variantId,
      quantity: line.quantity,
      expiresAt: input.expiresAt,
    });
  }
}

/**
 * Releases unpaid reservations past their expiry and cancels the orders they
 * held stock for. Orders are locked first (the same order payment settlement
 * takes), and rows locked by a concurrent settlement are skipped, so a payment
 * being confirmed is never raced into a cancelled order. The released_at guard
 * makes this idempotent: stock returns exactly once even with concurrent
 * workers. Returns the number of reservations released.
 */
export async function releaseExpiredReservations(db: Db, now: Date = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`
      select o.id from orders o
      where exists (
        select 1 from stock_reservations r
        where r.order_id = o.id and r.released_at is null and r.consumed_at is null and r.expires_at <= ${now.toISOString()}::timestamptz
      )
      order by o.id
      for update of o skip locked`);
    const orderIds = [...locked].map((r) => r.id);
    if (orderIds.length === 0) return 0;

    const released = await tx
      .update(stockReservations)
      .set({ releasedAt: now })
      .where(
        and(
          inArray(stockReservations.orderId, orderIds),
          isNull(stockReservations.releasedAt),
          isNull(stockReservations.consumedAt),
          lte(stockReservations.expiresAt, now),
        ),
      )
      .returning({ variantId: stockReservations.variantId, quantity: stockReservations.quantity });

    const perVariant = new Map<string, number>();
    for (const r of released) perVariant.set(r.variantId, (perVariant.get(r.variantId) ?? 0) + r.quantity);

    for (const [variantId, quantity] of [...perVariant].sort(([a], [b]) => a.localeCompare(b))) {
      await tx
        .update(inventory)
        .set({ reservedQuantity: sql`${inventory.reservedQuantity} - ${quantity}` })
        .where(eq(inventory.variantId, variantId));
    }

    await releasePromotionHolds(tx, orderIds);

    // Unpaid orders whose hold is gone are cancelled; a later verified charge is flagged as a payment exception.
    const cancelled = await tx
      .update(orders)
      .set({ status: 'cancelled', paymentStatus: 'failed' })
      .where(and(inArray(orders.id, orderIds), eq(orders.status, 'pending_payment'), eq(orders.paymentStatus, 'pending')))
      .returning({ id: orders.id });
    if (cancelled.length > 0) {
      const ids = cancelled.map((o) => o.id);
      await tx
        .update(paymentAttempts)
        .set({ status: 'expired' })
        .where(and(inArray(paymentAttempts.orderId, ids), inArray(paymentAttempts.status, ['initializing', 'pending'])));
      await tx.insert(orderStatusEvents).values(
        ids.map((orderId) => ({
          orderId,
          fromStatus: 'pending_payment' as const,
          toStatus: 'cancelled' as const,
          actorType: 'system',
          note: 'RESERVATION_EXPIRED',
        })),
      );
    }
    return released.length;
  });
}

function mergeLines(lines: ReservationLine[]): ReservationLine[] {
  const merged = new Map<string, number>();
  for (const { variantId, quantity } of lines) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError('quantity must be a positive integer');
    merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  }
  return [...merged]
    .map(([variantId, quantity]) => ({ variantId, quantity }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}
