import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { collections, products, promotionHolds } from '../../db/schema/index.js';
import type { PromotionTerms } from './load-promotions.js';
import { qualification, SCOPE_SCHEMA, type EngineLine, type EnginePromotion } from './promotions.js';
import { availableOf, displayData, liveVariants, type LineImage } from './variants.js';

/** Scarcity is mentioned only when it is real and close: at most this many claims or gifts left. */
export const FEW_CLAIMS_LEFT = 10;
export const FEW_GIFTS_LEFT = 5;
const MAX_OFFERS = 6;
const MAX_NAMED = 3;

export type GiftOffer = {
  promotionId: string;
  name: string;
  /** `unlocked`: the gift is in this order. `locked`: `needs` says what is still missing. */
  status: 'unlocked' | 'locked';
  needs: {
    /** The offer depends on who is buying (first order, one per customer), so a guest has to sign in. */
    signIn: boolean;
    /** Nothing in the bag is covered by the offer yet. */
    qualifyingItem: boolean;
    /** Still to be spent on covered items. */
    spendMinor: number;
  };
  firstOrderOnly: boolean;
  gift: { variantId: string; slug: string; title: string; optionSummary: string; image: LineImage | null; quantity: number; valueMinor: number };
  minimumSubtotalMinor: number | null;
  eligibleSubtotalMinor: number;
  /** What counts towards the offer: everything, or these collections and products. */
  qualifying: { allProducts: boolean; collections: { slug: string; name: string }[]; products: { slug: string; title: string }[] };
  endsAt: string | null;
  /** How many more can be had, when few enough to say so; otherwise null. */
  leftCount: number | null;
};

type Scope = { include?: { allProducts?: boolean; productIds?: string[]; collectionIds?: string[] } };

/** The live collections and products a scope names, so a shopper can be told what to add. */
async function describeScope(db: Db, scope: unknown): Promise<GiftOffer['qualifying']> {
  const include = ((SCOPE_SCHEMA.validate(scope ?? {}).value ?? {}) as Scope).include ?? {};
  const productIds = include.productIds ?? [];
  const collectionIds = include.collectionIds ?? [];
  if (include.allProducts === true || (productIds.length === 0 && collectionIds.length === 0)) return { allProducts: true, collections: [], products: [] };
  const [named, listed] = await Promise.all([
    collectionIds.length
      ? db.select({ slug: collections.slug, name: collections.name }).from(collections).where(and(inArray(collections.id, collectionIds), eq(collections.active, true))).orderBy(collections.sortOrder, collections.name).limit(MAX_NAMED)
      : [],
    productIds.length
      ? db.select({ slug: products.slug, title: products.title }).from(products).where(and(inArray(products.id, productIds), eq(products.status, 'active'), or(isNull(products.publishedAt), lte(products.publishedAt, sql`now()`)))).orderBy(products.title).limit(MAX_NAMED)
      : [],
  ]);
  return { allProducts: false, collections: named, products: listed };
}

/**
 * The free gifts this order has earned or could still earn, for telling the shopper about. It looks only at offers the
 * order could really get: automatic ones, a code the shopper entered, and automatic ones that need a sign-in. A code
 * nobody entered is never revealed. A gift that is out of stock, or an offer that cannot be reached, is left out.
 * Whether a gift is actually given is decided by the pricing engine (`unlocked`), never here.
 */
export async function findGiftOffers(
  db: Db,
  input: {
    promotions: EnginePromotion[];
    signInOnly: EnginePromotion[];
    terms: Map<string, PromotionTerms>;
    lines: EngineLine[];
    currency: string;
    /** What the order already takes from stock, gifts included. */
    taken: { variantId: string; quantity: number }[];
    unlocked: Set<string>;
  },
): Promise<GiftOffer[]> {
  const candidates = [
    ...input.promotions.map((promo) => ({ promo, signIn: false })),
    ...input.signInOnly.map((promo) => ({ promo, signIn: true })),
  ].flatMap(({ promo, signIn }) => {
    if (promo.kind !== 'free_gift' || promo.currency !== input.currency) return [];
    const found = qualification(input.lines, promo);
    return found ? [{ promo, signIn, ...found }] : [];
  });
  if (candidates.length === 0) return [];

  const rows = new Map((await liveVariants(db, [...new Set(candidates.map((c) => c.config.variantId))])).map((r) => [r.variantId, r]));
  if (rows.size === 0) return [];
  const display = await displayData(db, [...rows.values()]);
  const held = await db
    .select({ promotionId: promotionHolds.promotionId, n: sql<number>`count(*)::int` })
    .from(promotionHolds)
    .where(inArray(promotionHolds.promotionId, candidates.map((c) => c.promo.id)))
    .groupBy(promotionHolds.promotionId);
  const heldBy = new Map(held.map((h) => [h.promotionId, h.n]));
  const taken = new Map<string, number>();
  for (const t of input.taken) taken.set(t.variantId, (taken.get(t.variantId) ?? 0) + t.quantity);

  const offers: GiftOffer[] = [];
  for (const { promo, signIn, config, eligible, eligibleSubtotal, shortfallMinor } of candidates) {
    const row = rows.get(config.variantId);
    const terms = input.terms.get(promo.id);
    if (!row || !terms || row.currency !== input.currency) continue;

    const unlocked = input.unlocked.has(promo.id);
    const needs = { signIn, qualifyingItem: eligible.length === 0, spendMinor: shortfallMinor };
    // An order that meets the rule but has no gift line cannot be given one (no stock left for it).
    if (!unlocked && !needs.signIn && !needs.qualifyingItem && needs.spendMinor === 0) continue;
    const spare = availableOf(row) - (taken.get(config.variantId) ?? 0);
    if (!unlocked && spare < config.quantity) continue;

    const qualifying = await describeScope(db, promo.scope);
    if (!unlocked && needs.qualifyingItem && !qualifying.allProducts && qualifying.collections.length + qualifying.products.length === 0) continue;

    const claims = terms.totalUsageLimit === null ? Infinity : terms.totalUsageLimit - terms.usageCount - (heldBy.get(promo.id) ?? 0);
    const gifts = Math.floor(spare / config.quantity);
    const left = Math.min(claims <= FEW_CLAIMS_LEFT ? claims : Infinity, gifts <= FEW_GIFTS_LEFT ? gifts : Infinity);

    offers.push({
      promotionId: promo.id,
      name: promo.name,
      status: unlocked ? 'unlocked' : 'locked',
      needs: unlocked ? { signIn: false, qualifyingItem: false, spendMinor: 0 } : needs,
      firstOrderOnly: terms.firstOrderOnly,
      gift: {
        variantId: row.variantId,
        slug: row.slug,
        title: row.title,
        optionSummary: (display.optionsByVariant.get(row.variantId) ?? []).map((o) => o.label).join(' · '),
        image: display.imageByProduct.get(row.productId) ?? null,
        quantity: config.quantity,
        valueMinor: row.priceMinor * config.quantity,
      },
      minimumSubtotalMinor: promo.minimumSubtotalMinor,
      eligibleSubtotalMinor: eligibleSubtotal,
      qualifying,
      endsAt: terms.endsAt?.toISOString() ?? null,
      leftCount: unlocked || left === Infinity ? null : Math.max(left, 1),
    });
  }

  // Earned gifts first, then the nearest to being earned: nothing to add, then the smallest amount still to spend.
  const rank = (o: GiftOffer) => [o.status === 'unlocked' ? 0 : 1, o.needs.qualifyingItem ? 1 : 0, o.needs.spendMinor, -o.gift.valueMinor];
  return offers
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      const i = x.findIndex((v, k) => v !== y[k]);
      return i < 0 ? a.promotionId.localeCompare(b.promotionId) : x[i]! - y[i]!;
    })
    .slice(0, MAX_OFFERS);
}
