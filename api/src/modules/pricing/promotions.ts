import Joi from 'joi';
import { allocate } from './allocate.js';

const version = Joi.number().valid(1).required();
const uuids = Joi.array().items(Joi.string().uuid()).max(500);

/** Versioned application schemas for promotion `configuration` and `scope`; JSON is data, never executed. */
export const CONFIG_SCHEMAS = {
  percentage: Joi.object({
    version,
    percent: Joi.number().greater(0).max(100).precision(2).required(),
    maxDiscountMinor: Joi.number().integer().min(0),
  }),
  fixed_amount: Joi.object({ version, amountMinor: Joi.number().integer().min(1).required() }),
  buy_x_get_y: Joi.object({
    version,
    buy: Joi.number().integer().min(1).required(),
    get: Joi.number().integer().min(1).required(),
    percentOff: Joi.number().greater(0).max(100).precision(2).default(100),
  }),
  free_delivery: Joi.object({ version, zoneIds: uuids }),
  // A free item added to the order: the variant to give, and how many.
  free_gift: Joi.object({ version, variantId: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).max(10).default(1) }),
} as const;

export const SCOPE_SCHEMA = Joi.object({
  include: Joi.object({ allProducts: Joi.boolean(), productIds: uuids, collectionIds: uuids }),
  excludeProductIds: uuids,
});

export type PromotionKind = keyof typeof CONFIG_SCHEMAS;

/** Union of every kind's fields; which ones exist is guaranteed by the Joi schema chosen for `promo.kind` just before use. */
type RuleConfig = { percent: number; maxDiscountMinor?: number; amountMinor: number; buy: number; get: number; percentOff: number; zoneIds?: string[]; variantId: string; quantity: number };

export type EnginePromotion = {
  id: string;
  name: string;
  kind: PromotionKind;
  configuration: unknown;
  scope: unknown;
  priority: number;
  minimumSubtotalMinor: number | null;
  currency: string;
  createdAt: Date;
  /** The code the shopper submitted for this promotion, or null for automatic promotions. */
  code: string | null;
};

export type EngineLine = {
  variantId: string;
  productId: string;
  collectionIds: string[];
  quantity: number;
  unitPriceMinor: number;
};

export type RejectedCode = { code: string; reason: 'NOT_APPLICABLE' | 'MIN_SPEND_NOT_MET' };

/** A free item the order earns. The cart prices it (and drops it if it is out of stock). */
export type EngineGift = { promotionId: string; name: string; code: string | null; variantId: string; quantity: number };

export type EngineResult = {
  /** Per input line, in order. */
  allocations: { promotionId: string; amountMinor: number }[][];
  applied: { promotionId: string; name: string; kind: PromotionKind; code: string | null; discountMinor: number }[];
  freeDelivery: { promotionId: string } | null;
  gifts: EngineGift[];
  rejectedCodes: RejectedCode[];
};

function validated<T>(schema: Joi.Schema, value: unknown): T | null {
  const { value: v, error } = schema.validate(value ?? {}, { stripUnknown: false });
  return error ? null : (v as T);
}

function eligibleIndexes(scope: unknown, lines: EngineLine[]): number[] | null {
  const s = validated<{
    include?: { allProducts?: boolean; productIds?: string[]; collectionIds?: string[] };
    excludeProductIds?: string[];
  }>(SCOPE_SCHEMA, scope);
  if (!s) return null;

  const productIds = new Set(s.include?.productIds ?? []);
  const collectionIds = new Set(s.include?.collectionIds ?? []);
  const excluded = new Set(s.excludeProductIds ?? []);
  // An empty scope, or allProducts, means every product before exclusions.
  const everything = s.include?.allProducts === true || (productIds.size === 0 && collectionIds.size === 0);

  return lines.flatMap((l, i) => {
    if (excluded.has(l.productId)) return [];
    const included = everything || productIds.has(l.productId) || l.collectionIds.some((c) => collectionIds.has(c));
    return included ? [i] : [];
  });
}

/** A discount on the items themselves that needs no code. Every eligible item gets it, so a minimum spend does not apply. */
const isAutomaticDiscount = (promo: EnginePromotion) => promo.code === null && (promo.kind === 'percentage' || promo.kind === 'fixed_amount' || promo.kind === 'buy_x_get_y');

/** How far these lines are from a promotion's rule; null when the stored rule cannot be read. */
export function qualification(lines: EngineLine[], promo: EnginePromotion) {
  const config = validated<RuleConfig>(CONFIG_SCHEMAS[promo.kind], promo.configuration);
  const eligible = eligibleIndexes(promo.scope, lines);
  if (!config || !eligible) return null;
  const eligibleSubtotal = eligible.reduce((sum, i) => sum + lines[i]!.unitPriceMinor * lines[i]!.quantity, 0);
  const minimumMinor = isAutomaticDiscount(promo) ? 0 : (promo.minimumSubtotalMinor ?? 0);
  return { config, eligible, eligibleSubtotal, shortfallMinor: Math.max(minimumMinor - eligibleSubtotal, 0) };
}

/** One unit in the bag: its price, and the automatic discount it ended up with. */
type Unit = { line: number; price: number; off: number; promotionId: string | null };

/** `percent` of an amount in minor units, rounded down. */
const share = (amountMinor: number, percent: number) => Number((BigInt(amountMinor) * BigInt(Math.round(percent * 100))) / 10000n);

/** buy_x_get_y: in every group of (buy + get) units the `get` cheapest earn percentOff. Returns what comes off each rewarded unit. */
function rewardUnits(units: Unit[], lines: EngineLine[], config: RuleConfig, priceOf: (u: Unit) => number): [Unit, number][] {
  const sorted = [...units].sort((a, b) => priceOf(a) - priceOf(b) || lines[a.line]!.variantId.localeCompare(lines[b.line]!.variantId));
  const rewarded = Math.floor(sorted.length / (config.buy + config.get)) * config.get;
  return sorted.slice(0, rewarded).map((u) => [u, share(priceOf(u), config.percentOff)]);
}

/**
 * Deterministic promotion resolution, unit by unit.
 *
 * 1. Automatic discounts (percentage, fixed_amount, buy_x_get_y without a code). Every unit takes the one that saves
 *    it most. They never add up on a unit and never block each other. A percentage (and its cap) and a fixed amount
 *    are worked out on each unit, so every eligible unit gets the discount however many are in the bag. buy_x_get_y
 *    rewards its cheapest units; the units that earn the reward may still carry another discount.
 * 2. At most one promo code, on top, worked out on what is left after the automatic discounts. A percentage (and its
 *    cap) or fixed amount is taken once for the order and spread across the eligible lines.
 *
 * Free delivery targets the delivery fee, not line amounts; the first eligible one wins, automatic ones first. A free
 * gift adds its item. A minimum spend counts only for codes, free delivery and gifts (automatic discounts ignore it)
 * and is measured on all the lines in the promotion's scope, before any discount. Ties
 * go by priority desc, created_at asc, id asc.
 */
export function applyPromotions(input: {
  lines: EngineLine[];
  promotions: EnginePromotion[];
  currency: string;
  zoneId?: string | undefined;
}): EngineResult {
  const { lines } = input;
  const result: EngineResult = {
    allocations: lines.map(() => []),
    applied: [],
    freeDelivery: null,
    gifts: [],
    rejectedCodes: [],
  };

  const ordered = [...input.promotions]
    .filter((p) => p.currency === input.currency)
    .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  const reject = (p: EnginePromotion, reason: RejectedCode['reason']) => {
    if (p.code) result.rejectedCodes.push({ code: p.code, reason });
  };

  /** The promotion's rule and the lines it covers, or null (with the reason recorded) when this order does not qualify. */
  const qualify = (promo: EnginePromotion) => {
    const found = qualification(lines, promo);
    if (!found || found.eligible.length === 0) {
      reject(promo, 'NOT_APPLICABLE');
      return null;
    }
    if (found.shortfallMinor > 0) {
      reject(promo, 'MIN_SPEND_NOT_MET');
      return null;
    }
    return found;
  };

  /** Free delivery and gifts take nothing off the lines. */
  const grantExtra = (promo: EnginePromotion, config: RuleConfig) => {
    if (promo.kind === 'free_gift') {
      result.gifts.push({ promotionId: promo.id, name: promo.name, code: promo.code, variantId: config.variantId, quantity: config.quantity });
      return;
    }
    const zoneIds: string[] = config.zoneIds ?? [];
    const zoneOk = zoneIds.length === 0 || (input.zoneId !== undefined && zoneIds.includes(input.zoneId));
    if (zoneOk && !result.freeDelivery) result.freeDelivery = { promotionId: promo.id };
    else reject(promo, 'NOT_APPLICABLE');
  };
  const isExtra = (promo: EnginePromotion) => promo.kind === 'free_delivery' || promo.kind === 'free_gift';

  const record = (promo: EnginePromotion, perLine: Map<number, number>) => {
    let discount = 0;
    for (const [i, amountMinor] of [...perLine].sort(([a], [b]) => a - b)) {
      if (amountMinor <= 0) continue;
      result.allocations[i]!.push({ promotionId: promo.id, amountMinor });
      discount += amountMinor;
    }
    if (discount > 0) result.applied.push({ promotionId: promo.id, name: promo.name, kind: promo.kind, code: promo.code, discountMinor: discount });
    else reject(promo, 'NOT_APPLICABLE');
  };

  const units: Unit[] = lines.flatMap((l, line) => Array.from({ length: l.quantity }, () => ({ line, price: l.unitPriceMinor, off: 0, promotionId: null })));
  const unitsOn = (eligible: number[]) => {
    const set = new Set(eligible);
    return units.filter((u) => set.has(u.line));
  };

  const automatic = ordered.filter((p) => p.code === null);
  for (const promo of automatic) {
    const rule = qualify(promo);
    if (!rule) continue;
    const { config, eligible } = rule;
    if (isExtra(promo)) {
      grantExtra(promo, config);
      continue;
    }
    const offers: [Unit, number][] =
      promo.kind === 'buy_x_get_y'
        ? rewardUnits(unitsOn(eligible), lines, config, (u) => u.price)
        : unitsOn(eligible).map((u) => [
            u,
            promo.kind === 'percentage' ? Math.min(share(u.price, config.percent), config.maxDiscountMinor ?? u.price) : Math.min(config.amountMinor, u.price),
          ]);
    // Only a bigger saving replaces what a unit has, so a tie stays with the promotion that came first.
    for (const [unit, off] of offers) {
      if (off > unit.off) Object.assign(unit, { off, promotionId: promo.id });
    }
  }
  for (const promo of automatic) {
    const perLine = new Map<number, number>();
    for (const u of units) if (u.promotionId === promo.id) perLine.set(u.line, (perLine.get(u.line) ?? 0) + u.off);
    if (perLine.size > 0) record(promo, perLine);
  }

  // One code per order. The API accepts no more than one; any further one given here is turned down.
  const [coded, ...extra] = ordered.filter((p) => p.code !== null);
  for (const p of extra) reject(p, 'NOT_APPLICABLE');
  const rule = coded ? qualify(coded) : null;
  if (!coded || !rule) return result;
  const { config, eligible } = rule;
  if (isExtra(coded)) {
    grantExtra(coded, config);
    return result;
  }

  let perLine: Map<number, number>;
  if (coded.kind === 'buy_x_get_y') {
    perLine = new Map();
    const paidFor = unitsOn(eligible).filter((u) => u.price > u.off);
    for (const [u, off] of rewardUnits(paidFor, lines, config, (x) => x.price - x.off)) perLine.set(u.line, (perLine.get(u.line) ?? 0) + off);
  } else {
    const weights = eligible.map((i) => unitsOn([i]).reduce((sum, u) => sum + u.price - u.off, 0));
    const pool = weights.reduce((a, b) => a + b, 0);
    const total = coded.kind === 'percentage' ? Math.min(share(pool, config.percent), config.maxDiscountMinor ?? pool) : Math.min(config.amountMinor, pool);
    const parts = allocate(total, weights);
    perLine = new Map(eligible.map((i, k) => [i, parts[k]!]));
  }
  record(coded, perLine);
  return result;
}
