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
  stackable: boolean;
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

/**
 * Deterministic promotion resolution.
 *
 * Order: priority desc, created_at asc, id asc. Line-discount promotions
 * (percentage, fixed_amount, buy_x_get_y) apply in that order; one after the
 * first applies only if it and every already-applied promotion are stackable.
 * A promotion that yields no discount does not block later ones. Free delivery
 * targets the delivery fee, not line amounts, so it always combines; the first
 * eligible one wins. A free gift also always combines and adds its item. Minimum spend is measured on the promotion's eligible
 * lines before any discount.
 */
export function applyPromotions(input: {
  lines: EngineLine[];
  promotions: EnginePromotion[];
  currency: string;
  zoneId?: string | undefined;
}): EngineResult {
  const { lines } = input;
  const remaining = lines.map((l) => l.unitPriceMinor * l.quantity);
  const result: EngineResult = {
    allocations: lines.map(() => []),
    applied: [],
    freeDelivery: null,
    gifts: [],
    rejectedCodes: [],
  };

  const appliedPromos: EnginePromotion[] = [];
  const ordered = [...input.promotions]
    .filter((p) => p.currency === input.currency)
    .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  const reject = (p: EnginePromotion, reason: RejectedCode['reason']) => {
    if (p.code) result.rejectedCodes.push({ code: p.code, reason });
  };

  for (const promo of ordered) {
    const schema = CONFIG_SCHEMAS[promo.kind];
    const config = validated<RuleConfig>(schema, promo.configuration);
    const eligible = eligibleIndexes(promo.scope, lines);
    if (!config || !eligible) {
      reject(promo, 'NOT_APPLICABLE');
      continue;
    }

    const eligibleSubtotal = eligible.reduce((sum, i) => sum + lines[i]!.unitPriceMinor * lines[i]!.quantity, 0);
    if (eligible.length === 0) {
      reject(promo, 'NOT_APPLICABLE');
      continue;
    }
    if (promo.minimumSubtotalMinor !== null && eligibleSubtotal < promo.minimumSubtotalMinor) {
      reject(promo, 'MIN_SPEND_NOT_MET');
      continue;
    }

    if (promo.kind === 'free_delivery') {
      const zoneIds: string[] = config.zoneIds ?? [];
      const zoneOk = zoneIds.length === 0 || (input.zoneId !== undefined && zoneIds.includes(input.zoneId));
      if (zoneOk && !result.freeDelivery) result.freeDelivery = { promotionId: promo.id };
      else if (!zoneOk) reject(promo, 'NOT_APPLICABLE');
      continue;
    }

    // A gift adds an item rather than taking money off lines, so like free delivery it combines with everything.
    if (promo.kind === 'free_gift') {
      result.gifts.push({ promotionId: promo.id, name: promo.name, code: promo.code, variantId: config.variantId, quantity: config.quantity });
      continue;
    }

    const stacks = appliedPromos.length === 0 || (promo.stackable && appliedPromos.every((a) => a.stackable));
    if (!stacks) {
      reject(promo, 'NOT_APPLICABLE');
      continue;
    }

    const weights = eligible.map((i) => remaining[i]!);
    const pool = weights.reduce((a, b) => a + b, 0);
    let perLine: number[] = eligible.map(() => 0);

    if (promo.kind === 'percentage') {
      const bps = Math.round(config.percent * 100);
      let total = Number((BigInt(pool) * BigInt(bps)) / 10000n);
      if (config.maxDiscountMinor !== undefined) total = Math.min(total, config.maxDiscountMinor);
      perLine = allocate(total, weights);
    } else if (promo.kind === 'fixed_amount') {
      perLine = allocate(Math.min(config.amountMinor, pool), weights);
    } else {
      // buy_x_get_y: in every group of (buy + get) eligible units the `get` cheapest earn percentOff.
      const units = eligible
        .flatMap((i) => Array.from({ length: lines[i]!.quantity }, () => i))
        .sort((a, b) => lines[a]!.unitPriceMinor - lines[b]!.unitPriceMinor || lines[a]!.variantId.localeCompare(lines[b]!.variantId));
      const rewarded = Math.floor(units.length / (config.buy + config.get)) * config.get;
      const bps = Math.round(config.percentOff * 100);
      const byLine = new Map<number, number>();
      for (const i of units.slice(0, rewarded)) {
        const off = Number((BigInt(lines[i]!.unitPriceMinor) * BigInt(bps)) / 10000n);
        byLine.set(i, (byLine.get(i) ?? 0) + off);
      }
      perLine = eligible.map((i, k) => Math.min(byLine.get(i) ?? 0, weights[k]!));
    }

    const discount = perLine.reduce((a, b) => a + b, 0);
    if (discount <= 0) {
      reject(promo, 'NOT_APPLICABLE');
      continue;
    }
    eligible.forEach((i, k) => {
      if (perLine[k]! > 0) {
        remaining[i] = remaining[i]! - perLine[k]!;
        result.allocations[i]!.push({ promotionId: promo.id, amountMinor: perLine[k]! });
      }
    });
    appliedPromos.push(promo);
    result.applied.push({ promotionId: promo.id, name: promo.name, kind: promo.kind, code: promo.code, discountMinor: discount });
  }
  return result;
}
