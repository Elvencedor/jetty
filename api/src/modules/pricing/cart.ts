import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { inventory, productCollections, productMedia, productOptionValues, productOptions, productVariants, products, variantOptionValues } from '../../db/schema/index.js';
import { unprocessable } from '../../lib/errors.js';
import { loadPromotions, type CodeRejection } from './load-promotions.js';
import { applyPromotions, type EngineLine, type PromotionKind, type RejectedCode } from './promotions.js';

export type CartItem = { variantId: string; quantity: number };

export type LineImage = { objectKey: string; altText: string | null; width: number | null; height: number | null };

export type PricedLine = {
  variantId: string;
  /** What a bag line needs to display itself, so clients never have to look the product up. */
  productId: string;
  slug: string;
  title: string;
  image: LineImage | null;
  options: { name: string; label: string }[];
  /** `20" · HD · 180%`: the chosen option labels in option order. */
  optionSummary: string;
  /** Struck-through "was" price per unit, when the variant is on offer. */
  compareAtPriceMinor: number | null;
  /** Units that can be bought right now (on hand minus reserved, never negative). */
  availableQuantity: number;
  quantity: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
  promotionAllocations: { promotionId: string; amountMinor: number }[];
  /** Set on a line the customer did not add: a free gift from this promotion. It costs nothing and cannot be edited. */
  gift: { promotionId: string } | null;
};

export type PricingWarning =
  | { code: 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK'; variantId: string; requestedQuantity: number; availableQuantity: number }
  | { code: 'GIFT_UNAVAILABLE'; promotionId: string; variantId: string }
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


/** The options and cover photo a bag line shows, for these variants. */
async function displayData(db: Db, rows: { variantId: string; productId: string }[]) {
  const ids = rows.map((r) => r.variantId);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const [optionRows, imageRows] = await Promise.all([
    db
      .select({ variantId: variantOptionValues.variantId, name: productOptions.name, label: productOptionValues.label, order: productOptions.sortOrder })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(productOptionValues.id, variantOptionValues.optionValueId))
      .innerJoin(productOptions, eq(productOptions.id, productOptionValues.optionId))
      .where(inArray(variantOptionValues.variantId, ids))
      .orderBy(asc(productOptions.sortOrder)),
    db
      .select({ productId: productMedia.productId, objectKey: productMedia.objectKey, altText: productMedia.altText, width: productMedia.width, height: productMedia.height })
      .from(productMedia)
      .where(inArray(productMedia.productId, productIds))
      .orderBy(desc(productMedia.isCover), asc(productMedia.sortOrder), asc(productMedia.createdAt)),
  ]);
  const optionsByVariant = new Map<string, { name: string; label: string }[]>();
  for (const o of optionRows) optionsByVariant.set(o.variantId, [...(optionsByVariant.get(o.variantId) ?? []), { name: o.name, label: o.label }]);
  const imageByProduct = new Map<string, LineImage>();
  for (const m of imageRows) if (!imageByProduct.has(m.productId)) imageByProduct.set(m.productId, { objectKey: m.objectKey, altText: m.altText, width: m.width, height: m.height });
  return { optionsByVariant, imageByProduct };
}

/** The variant rows (price, stock, product) for live, published products, in the shape the pricing code reads. */
const liveVariants = (db: Db, ids: string[]) =>
  db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      title: products.title,
      slug: products.slug,
      compareAt: productVariants.compareAtPriceMinor,
      priceMinor: productVariants.priceMinor,
      currency: productVariants.currency,
      onHand: inventory.onHandQuantity,
      reserved: inventory.reservedQuantity,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.status, 'active'), or(isNull(products.publishedAt), lte(products.publishedAt, sql`now()`))))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(inArray(productVariants.id, ids), eq(productVariants.active, true)));

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

  const rows = await liveVariants(db, ids);

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

  const { optionsByVariant, imageByProduct } = await displayData(db, rows);

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
    const row = byId.get(l.variantId)!;
    const options = optionsByVariant.get(l.variantId) ?? [];
    return {
      variantId: l.variantId,
      productId: row.productId,
      slug: row.slug,
      title: row.title,
      image: imageByProduct.get(row.productId) ?? null,
      options,
      optionSummary: options.map((o) => o.label).join(' · '),
      compareAtPriceMinor: row.compareAt !== null && row.compareAt > row.priceMinor ? row.compareAt : null,
      availableQuantity: Math.max((row.onHand ?? 0) - (row.reserved ?? 0), 0),
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineSubtotalMinor,
      discountMinor,
      lineTotalMinor: lineSubtotalMinor - discountMinor,
      promotionAllocations: allocations,
      gift: null,
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

  // Free gifts: a line per promotion that costs nothing. A gift that is gone or out of stock is left out (with a warning),
  // and its promotion is not counted as applied. Stock the customer's own lines take is not available to the gift.
  const applied = [...engine.applied];
  const gifts: PricedLine[] = [];
  if (engine.gifts.length > 0) {
    const giftRows = new Map((await liveVariants(db, [...new Set(engine.gifts.map((g) => g.variantId))])).map((r) => [r.variantId, r]));
    const display = await displayData(db, [...giftRows.values()]);
    const taken = new Map<string, number>(items.map((i) => [i.variantId, i.quantity]));
    for (const g of engine.gifts) {
      const row = giftRows.get(g.variantId);
      const available = row ? Math.max((row.onHand ?? 0) - (row.reserved ?? 0) - (taken.get(g.variantId) ?? 0), 0) : 0;
      if (!row || row.currency !== currency || available < g.quantity) {
        warnings.push({ code: 'GIFT_UNAVAILABLE', promotionId: g.promotionId, variantId: g.variantId });
        continue;
      }
      taken.set(g.variantId, (taken.get(g.variantId) ?? 0) + g.quantity);
      const value = row.priceMinor * g.quantity;
      const options = display.optionsByVariant.get(g.variantId) ?? [];
      gifts.push({
        variantId: g.variantId,
        productId: row.productId,
        slug: row.slug,
        title: row.title,
        image: display.imageByProduct.get(row.productId) ?? null,
        options,
        optionSummary: options.map((o) => o.label).join(' · '),
        compareAtPriceMinor: null,
        availableQuantity: available,
        quantity: g.quantity,
        unitPriceMinor: row.priceMinor,
        lineSubtotalMinor: value,
        discountMinor: value,
        lineTotalMinor: 0,
        promotionAllocations: [{ promotionId: g.promotionId, amountMinor: value }],
        gift: { promotionId: g.promotionId },
      });
      applied.push({ promotionId: g.promotionId, name: g.name, kind: 'free_gift', code: g.code, discountMinor: value });
    }
  }
  const allLines = [...lines, ...gifts];

  return {
    currency,
    lines: allLines,
    subtotalMinor: allLines.reduce((s, l) => s + l.lineSubtotalMinor, 0),
    discountMinor: allLines.reduce((s, l) => s + l.discountMinor, 0),
    promotions: { applied, rejectedCodes: [...loaded.rejections, ...engine.rejectedCodes] },
    freeDelivery: engine.freeDelivery,
    warnings,
  };
}
