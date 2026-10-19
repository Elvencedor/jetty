import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders, promotionCodes, promotionHolds, promotionRedemptions, promotions } from '../../db/schema/index.js';
import type { EnginePromotion, PromotionKind } from './promotions.js';

export type CodeRejection = {
  code: string;
  reason: 'INVALID_CODE' | 'EXPIRED' | 'USAGE_LIMIT_REACHED' | 'NOT_ELIGIBLE';
};

export const normaliseCode = (code: string) => code.trim().toUpperCase();

type Row = typeof promotions.$inferSelect;

const toEngine = (row: Row, code: string | null): EnginePromotion => ({
  id: row.id,
  name: row.name,
  kind: row.kind as PromotionKind,
  configuration: row.configuration,
  scope: row.scope,
  priority: row.priority,
  stackable: row.stackable,
  minimumSubtotalMinor: row.minimumSubtotalMinor,
  currency: row.currency,
  createdAt: row.createdAt,
  code,
});

/**
 * Loads promotions that could apply: every currently active automatic
 * promotion plus those unlocked by the submitted codes. Promotions with a
 * per-customer limit or restricted to first orders are excluded for guests (no customerId).
 */
export async function loadPromotions(
  db: Db,
  input: { codes: string[]; now: Date; customerId?: string | undefined },
): Promise<{ promotions: EnginePromotion[]; rejections: CodeRejection[]; withheldForGuests: boolean }> {
  const { now } = input;
  const inWindow = and(
    eq(promotions.status, 'active'),
    or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
    or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
  );
  // Open holds count as used, so a slot someone is paying for is not offered again.
  const withinTotalLimit = or(
    isNull(promotions.totalUsageLimit),
    sql`${promotions.usageCount} + (select count(*) from promotion_holds h where h.promotion_id = ${promotions.id}) < ${promotions.totalUsageLimit}`,
  );

  const automatic = await db
    .select()
    .from(promotions)
    .where(
      and(
        inWindow,
        withinTotalLimit,
        sql`not exists (select 1 from promotion_codes pc where pc.promotion_id = ${promotions.id})`,
      ),
    );

  const codes = [...new Set(input.codes.map(normaliseCode).filter(Boolean))];
  const coded = codes.length
    ? await db
        .select({ promotion: promotions, codeId: promotionCodes.id, code: promotionCodes.code, active: promotionCodes.active, max: promotionCodes.maxRedemptions, count: promotionCodes.redemptionCount })
        .from(promotionCodes)
        .innerJoin(promotions, eq(promotions.id, promotionCodes.promotionId))
        .where(inArray(promotionCodes.code, codes))
    : [];

  const heldByPromotion = new Map<string, number>();
  const heldByCode = new Map<string, number>();
  if (coded.length > 0) {
    const rowsHeld = await db
      .select({ promotionId: promotionHolds.promotionId, codeId: promotionHolds.promotionCodeId, n: sql<number>`count(*)::int` })
      .from(promotionHolds)
      .where(inArray(promotionHolds.promotionId, coded.map((c) => c.promotion.id)))
      .groupBy(promotionHolds.promotionId, promotionHolds.promotionCodeId);
    for (const r of rowsHeld) {
      heldByPromotion.set(r.promotionId, (heldByPromotion.get(r.promotionId) ?? 0) + r.n);
      if (r.codeId) heldByCode.set(r.codeId, (heldByCode.get(r.codeId) ?? 0) + r.n);
    }
  }

  const rejections: CodeRejection[] = [];
  const chosen = new Map<string, EnginePromotion>(automatic.map((p) => [p.id, toEngine(p, null)]));
  const byCode = new Map(coded.map((c) => [c.code, c]));

  for (const code of codes) {
    const c = byCode.get(code);
    if (!c || !c.active || c.promotion.status !== 'active') {
      rejections.push({ code, reason: 'INVALID_CODE' });
    } else if ((c.promotion.startsAt && c.promotion.startsAt > now) || (c.promotion.endsAt && c.promotion.endsAt <= now)) {
      rejections.push({ code, reason: 'EXPIRED' });
    } else if (
      (c.promotion.totalUsageLimit !== null && c.promotion.usageCount + (heldByPromotion.get(c.promotion.id) ?? 0) >= c.promotion.totalUsageLimit) ||
      (c.max !== null && c.count + (heldByCode.get(c.codeId) ?? 0) >= c.max)
    ) {
      rejections.push({ code, reason: 'USAGE_LIMIT_REACHED' });
    } else if (!chosen.has(c.promotion.id)) {
      chosen.set(c.promotion.id, toEngine(c.promotion, code));
    } else {
      // Already applying automatically or via another code; attach the code for reporting.
      const existing = chosen.get(c.promotion.id)!;
      if (!existing.code) existing.code = code;
    }
  }

  const rows = [...automatic, ...coded.map((c) => c.promotion)];

  // Offers tied to who the buyer is (first order only, per-customer limits) cannot be verified for a guest,
  // so guests never get them; a submitted code for one is rejected, and the quote tells the client to sign in.
  let withheldForGuests = false;
  if (!input.customerId) {
    for (const [id, p] of [...chosen]) {
      const row = rows.find((r) => r.id === id)!;
      if (row.perCustomerLimit === null && !row.firstOrderOnly) continue;
      chosen.delete(id);
      withheldForGuests = true;
      if (p.code) rejections.push({ code: p.code, reason: 'NOT_ELIGIBLE' });
    }
  }

  if (input.customerId) {
    const [{ paid } = { paid: 0 }] = await db
      .select({ paid: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.customerId, input.customerId), eq(orders.paymentStatus, 'paid')));
    const used = await db
      .select({ promotionId: promotionRedemptions.promotionId, n: sql<number>`count(*)::int` })
      .from(promotionRedemptions)
      .where(eq(promotionRedemptions.customerId, input.customerId))
      .groupBy(promotionRedemptions.promotionId);
    const usedBy = new Map(used.map((u) => [u.promotionId, u.n]));
    const heldByMe = await db
      .select({ promotionId: promotionHolds.promotionId, n: sql<number>`count(*)::int` })
      .from(promotionHolds)
      .where(eq(promotionHolds.customerId, input.customerId))
      .groupBy(promotionHolds.promotionId);
    for (const h of heldByMe) usedBy.set(h.promotionId, (usedBy.get(h.promotionId) ?? 0) + h.n);

    for (const [id, p] of [...chosen]) {
      const row = rows.find((r) => r.id === id)!;
      const reason: CodeRejection['reason'] | null =
        row.firstOrderOnly && paid > 0
          ? 'NOT_ELIGIBLE'
          : row.perCustomerLimit !== null && (usedBy.get(id) ?? 0) >= row.perCustomerLimit
            ? 'USAGE_LIMIT_REACHED'
            : null;
      if (reason) {
        chosen.delete(id);
        if (p.code) rejections.push({ code: p.code, reason });
      }
    }
  }

  return {
    promotions: [...chosen.values()],
    rejections,
    withheldForGuests,
  };
}
