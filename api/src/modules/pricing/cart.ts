import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { inventory, productCollections, productVariants, products } from '../../db/schema/index.js';
import { unprocessable } from '../../lib/errors.js';
import { loadPromotions, type CodeRejection } from './load-promotions.js';
import { applyPromotions, type EngineLine, type PromotionKind, type RejectedCode } from './promotions.js';

export type CartItem = { variantId: string; quantity: number };

export type PricedLine = {
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
  promotionAllocations: { promotionId: string; amountMinor: number }[];
};

export type PricingWarning =
  | { code: 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK'; variantId: string; requestedQuantity: number; availableQuantity: number }
  | { code: 'SIGN_IN_FOR_OFFERS' };

export type PricedCart = {
  currency: string;
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  promotions: {
    applied: { promotionId: string; name: string; kind: PromotionKind; code: string | null; discountMinor: number }[];
    rejectedCodes: (CodeRejection | (RejectedCode & { reason: RejectedCode['reason'] }))[];
  };
  freeDelivery: { promotionId: string } | null;
  warnings: PricingWarning[];
};

/** Merges duplicate variant lines so a client cannot split a line to dodge per-line rules. */
export function mergeItems(items: CartItem[]): CartItem[] {
  const merged = new Map<string, number>();
  for (const { variantId, quantity } of items) merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

/**
 * The single pricing service. Prices come only from persisted variants; the
 * client supplies variant IDs, quantities and promotion codes, nothing else.
 * Read-only: no reservation and no redemption is recorded here.
 */
export async function priceCart(
  db: Db,
  input: { items: CartItem[]; promotionCodes: string[]; zoneId?: string | undefined; customerId?: string | undefined; now?: Date },
): Promise<PricedCart> {
  const now = input.now ?? new Date();
  const items = mergeItems(input.items);
  const ids = items.map((i) => i.variantId);

  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      priceMinor: productVariants.priceMinor,
      currency: productVariants.currency,
      onHand: inventory.onHandQuantity,
      reserved: inventory.reservedQuantity,
    })
    .from(productVariants)
    .innerJoin(
      products,
      and(
        eq(products.id, productVariants.productId),
        eq(products.status, 'active'),
        or(isNull(products.publishedAt), lte(products.publishedAt, sql`now()`)),
      ),
    )
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(inArray(productVariants.id, ids), eq(productVariants.active, true)));

  const byId = new Map(rows.map((r) => [r.variantId, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw unprocessable(
      'VARIANT_UNAVAILABLE',
      'One or more items are no longer available.',
      missing.map((variantId) => ({ variantId })),
    );
  }

  const currencies = new Set(rows.map((r) => r.currency));
  if (currencies.size > 1) throw unprocessable('CURRENCY_MISMATCH', 'Items in one order must share a currency.');
  const currency = [...currencies][0]!;

  const memberships = await db
    .select({ productId: productCollections.productId, collectionId: productCollections.collectionId })
    .from(productCollections)
    .where(inArray(productCollections.productId, [...new Set(rows.map((r) => r.productId))]));
  const collectionsByProduct = new Map<string, string[]>();
  for (const m of memberships) collectionsByProduct.set(m.productId, [...(collectionsByProduct.get(m.productId) ?? []), m.collectionId]);

  const engineLines: EngineLine[] = items.map((item) => {
    const row = byId.get(item.variantId)!;
    return {
      variantId: item.variantId,
      productId: row.productId,
      collectionIds: collectionsByProduct.get(row.productId) ?? [],
      quantity: item.quantity,
      unitPriceMinor: row.priceMinor,
    };
  });

  const loaded = await loadPromotions(db, { codes: input.promotionCodes, now, customerId: input.customerId });
  const engine = applyPromotions({ lines: engineLines, promotions: loaded.promotions, currency, zoneId: input.zoneId });

  const lines: PricedLine[] = engineLines.map((l, i) => {
    const allocations = engine.allocations[i]!;
    const discountMinor = allocations.reduce((sum, a) => sum + a.amountMinor, 0);
    const lineSubtotalMinor = l.unitPriceMinor * l.quantity;
    return {
      variantId: l.variantId,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineSubtotalMinor,
      discountMinor,
      lineTotalMinor: lineSubtotalMinor - discountMinor,
      promotionAllocations: allocations,
    };
  });

  const warnings: PricingWarning[] = [];
  for (const item of items) {
    const row = byId.get(item.variantId)!;
    const available = Math.max((row.onHand ?? 0) - (row.reserved ?? 0), 0);
    if (available < item.quantity) {
      warnings.push({
        code: available === 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK',
        variantId: item.variantId,
        requestedQuantity: item.quantity,
        availableQuantity: available,
      });
    }
  }
  if (loaded.withheldForGuests) warnings.push({ code: 'SIGN_IN_FOR_OFFERS' });

  return {
    currency,
    lines,
    subtotalMinor: lines.reduce((s, l) => s + l.lineSubtotalMinor, 0),
    discountMinor: lines.reduce((s, l) => s + l.discountMinor, 0),
    promotions: { applied: engine.applied, rejectedCodes: [...loaded.rejections, ...engine.rejectedCodes] },
    freeDelivery: engine.freeDelivery,
    warnings,
  };
}
