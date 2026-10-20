import type { ProductDetail, Variant } from "@/lib/api/types";

/** The shopper's choices: option id → chosen option value id. */
export type Selection = Record<string, string>;

type Shape = Pick<ProductDetail, "options" | "variants" | "defaultVariantId">;

/** The selection that describes one variant. */
export function selectionOf(variant: Variant, product: Pick<ProductDetail, "options">): Selection {
  const selection: Selection = {};
  for (const option of product.options) {
    const value = option.values.find((v) => variant.optionValueIds.includes(v.id));
    if (value) selection[option.id] = value.id;
  }
  return selection;
}

/** What to preselect: the best seller that can be bought now, else the first buyable variant, else the first variant. */
export function initialSelection(product: Shape): Selection {
  const buyable = product.variants.filter((v) => v.availability.inStock);
  const start = product.variants.find((v) => v.id === product.defaultVariantId && v.availability.inStock) ?? buyable[0] ?? product.variants[0];
  return start ? selectionOf(start, product) : {};
}

/** The variant matching a complete selection, or undefined while a choice is missing or no such combination exists. */
export function resolveVariant(product: Shape, selection: Selection): Variant | undefined {
  if (product.options.some((o) => !selection[o.id])) return undefined;
  const chosen = new Set(Object.values(selection));
  return product.variants.find((v) => v.optionValueIds.length === chosen.size && v.optionValueIds.every((id) => chosen.has(id)));
}

export type ValueState = "available" | "soldOut" | "unavailable";

/**
 * Whether choosing `valueId` for `optionId` is possible given the other choices already made:
 * `available` (a buyable variant exists), `soldOut` (variants exist but none in stock), `unavailable` (never made).
 */
export function valueState(product: Shape, selection: Selection, optionId: string, valueId: string): ValueState {
  const others = Object.entries(selection).filter(([id]) => id !== optionId).map(([, value]) => value);
  const matching = product.variants.filter((v) => v.optionValueIds.includes(valueId) && others.every((o) => v.optionValueIds.includes(o)));
  if (!matching.length) return "unavailable";
  return matching.some((v) => v.availability.inStock) ? "available" : "soldOut";
}

/**
 * The selection after choosing a value. If that makes the combination impossible, the other choices that conflict are
 * dropped (earlier options win), so the shopper is never stuck on a combination that does not exist.
 */
export function choose(product: Shape, selection: Selection, optionId: string, valueId: string): Selection {
  let next: Selection = { ...selection, [optionId]: valueId };
  for (const option of product.options) {
    const current = next[option.id];
    if (option.id === optionId || !current) continue;
    if (valueState(product, next, option.id, current) === "unavailable") {
      const { [option.id]: _drop, ...rest } = next;
      next = rest;
    }
  }
  return next;
}

/** The first option still without a choice, for the accordion's "auto-advance". */
export function firstOpenOption(product: Pick<ProductDetail, "options">, selection: Selection): string | undefined {
  return product.options.find((o) => !selection[o.id])?.id;
}

/** The lowest and highest variant price, ignoring none: used before a variant is chosen. */
export function priceRange(variants: Variant[]): { min: number; max: number } | null {
  if (!variants.length) return null;
  const prices = variants.map((v) => v.price.amountMinor);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
