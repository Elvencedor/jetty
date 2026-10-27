import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { promotionCodes, promotionHolds, promotionRedemptions, promotions } from '../../db/schema/index.js';
import { conflict } from '../../lib/errors.js';

export type HoldRequest = { promotionId: string; promotionCodeId: string | null; code?: string | null };

const count = sql<number>`count(*)::int`;

/**
 * First come, first served: takes a slot on every limited promotion the order
 * uses, inside the order transaction. Promotion and code rows are locked in id
 * order (settlement locks them the same way), so concurrent checkouts queue up
 * and each sees every earlier slot. A slot is available while
 * redemptions + open holds < limit; otherwise the whole checkout is refused
 * and the client re-quotes. Slots are freed by reservation expiry and turned
 * into redemptions by payment settlement.
 */
export async function acquirePromotionHolds(tx: Tx, input: { orderId: string; customerId: string | null; applied: HoldRequest[] }): Promise<void> {
  if (input.applied.length === 0) return;
  const ids = [...new Set(input.applied.map((a) => a.promotionId))].sort();
  const locked = await tx.select().from(promotions).where(inArray(promotions.id, ids)).orderBy(promotions.id).for('update');
  const byId = new Map(locked.map((p) => [p.id, p]));

  const codeIds = [...new Set(input.applied.map((a) => a.promotionCodeId).filter((c): c is string => c !== null))].sort();
  const codes = codeIds.length
    ? await tx.select().from(promotionCodes).where(inArray(promotionCodes.id, codeIds)).orderBy(promotionCodes.id).for('update')
    : [];
  const codeById = new Map(codes.map((c) => [c.id, c]));

  const unavailable: { promotionId: string; code: string | null }[] = [];
  const holds: (typeof promotionHolds.$inferInsert)[] = [];

  for (const a of input.applied) {
    const promotion = byId.get(a.promotionId);
    const code = a.promotionCodeId ? codeById.get(a.promotionCodeId) : undefined;
    const limited = promotion && (promotion.totalUsageLimit !== null || (promotion.perCustomerLimit !== null && input.customerId) || code?.maxRedemptions != null);
    if (!promotion || !limited) continue;

    let full = false;
    if (promotion.totalUsageLimit !== null) {
      const [{ n } = { n: 0 }] = await tx.select({ n: count }).from(promotionHolds).where(eq(promotionHolds.promotionId, promotion.id));
      full = promotion.usageCount + n >= promotion.totalUsageLimit;
    }
    if (!full && code && code.maxRedemptions !== null) {
      const [{ n } = { n: 0 }] = await tx.select({ n: count }).from(promotionHolds).where(eq(promotionHolds.promotionCodeId, code.id));
      full = code.redemptionCount + n >= code.maxRedemptions;
    }
    if (!full && promotion.perCustomerLimit !== null && input.customerId) {
      const [redeemed = { n: 0 }] = await tx
        .select({ n: count })
        .from(promotionRedemptions)
        .where(and(eq(promotionRedemptions.promotionId, promotion.id), eq(promotionRedemptions.customerId, input.customerId)));
      const [held = { n: 0 }] = await tx
        .select({ n: count })
        .from(promotionHolds)
        .where(and(eq(promotionHolds.promotionId, promotion.id), eq(promotionHolds.customerId, input.customerId)));
      full = redeemed.n + held.n >= promotion.perCustomerLimit;
    }
    if (full) unavailable.push({ promotionId: promotion.id, code: a.code ?? null });
    else holds.push({ promotionId: promotion.id, promotionCodeId: a.promotionCodeId, customerId: input.customerId, orderId: input.orderId });
  }

  if (unavailable.length > 0) {
    throw conflict('PROMOTION_UNAVAILABLE', 'A promotion on this order has just run out. Please review your order and try again.', unavailable);
  }
  if (holds.length > 0) await tx.insert(promotionHolds).values(holds).onConflictDoNothing();
}

export const releasePromotionHolds = (tx: Tx, orderIds: string[]) =>
  orderIds.length === 0 ? Promise.resolve() : tx.delete(promotionHolds).where(inArray(promotionHolds.orderId, orderIds));
