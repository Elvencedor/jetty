import type { AdminProductDetail, MatrixPayload } from "@/lib/api/admin-catalog";

/**
 * The editable form of a product's options and variants. Everything here is plain data and pure functions: the
 * screens hold a draft, call these to change it, and send `toPayload(draft)` in one `PUT .../variants`.
 *
 * Pricing model (as the design shows it): a product has a base price; every option value carries a difference from
 * it (`deltaMinor`, negative allowed); a variant's price is the base plus the differences of its values. The first
 * option "sets the base price", so its values display as absolute prices. The base is not stored: it is whatever
 * `price - differences` the product's variants already agree on. A variant may still have its own price ("custom").
 */
export type ValueDraft = { key: string; label: string; deltaMinor: number; swatch: string | null; active: boolean };
export type OptionDraft = { name: string; values: ValueDraft[] };
export type VariantDraft = {
  /** Absent until the variant has been saved. */
  id?: string;
  sku: string;
  /** Option name → value key. */
  values: Record<string, string>;
  priceMinor: number;
  compareAtMinor: number | null;
  active: boolean;
  onHand: number;
  reserved: number;
  lowStockThreshold: number | null;
};
export type MatrixDraft = { options: OptionDraft[]; variants: VariantDraft[] };

/** The most variants the API accepts for one product. */
export const MAX_VARIANTS = 2000;
export const MAX_OPTIONS = 6;
/** A variant at or below this many available units is "low" even without its own warning level. */
export const LOW_STOCK_AT = 1;

export const clone = (draft: MatrixDraft): MatrixDraft => structuredClone(draft);

export function fromDetail(detail: AdminProductDetail): MatrixDraft {
  return {
    options: detail.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ key: v.valueKey, label: v.label, deltaMinor: v.priceDeltaMinor, swatch: v.swatch, active: v.active })) })),
    variants: detail.variants.map((v) => ({
      id: v.id, sku: v.sku, values: { ...v.optionValues }, priceMinor: v.priceMinor, compareAtMinor: v.compareAtPriceMinor, active: v.active,
      onHand: v.stock.onHand, reserved: v.stock.reserved, lowStockThreshold: v.stock.lowStockThreshold,
    })),
  };
}

export function toPayload(draft: MatrixDraft): MatrixPayload {
  return {
    options: draft.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, valueKey: v.key, priceDeltaMinor: v.deltaMinor, active: v.active, swatch: v.swatch })) })),
    variants: draft.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      sku: v.sku,
      optionValues: v.values,
      priceMinor: v.priceMinor,
      compareAtPriceMinor: v.compareAtMinor,
      active: v.active,
      // Stock only seeds a variant that does not exist yet; changes to existing ones go through the stock ledger.
      ...(v.id ? {} : { stock: v.onHand }),
    })),
  };
}

// ------------------------------------------------------------------------------------------------ prices

const deltaOf = (draft: MatrixDraft, v: Pick<VariantDraft, "values">) =>
  draft.options.reduce((sum, o) => sum + (o.values.find((x) => x.key === v.values[o.name])?.deltaMinor ?? 0), 0);

/** The base price: the `price - differences` most of the variants agree on (0 when there are none). */
export function basePrice(draft: MatrixDraft): number {
  const counts = new Map<number, number>();
  for (const v of draft.variants) counts.set(v.priceMinor - deltaOf(draft, v), (counts.get(v.priceMinor - deltaOf(draft, v)) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [price, n] of counts) if (n > bestCount || (n === bestCount && price < best)) [best, bestCount] = [price, n];
  return best;
}

/** What a combination costs from the base and the values' differences. */
export const computedPrice = (draft: MatrixDraft, values: Record<string, string>) => basePrice(draft) + deltaOf(draft, { values });

/** True when a variant has been given a price of its own instead of the one its values add up to. */
export const hasCustomPrice = (draft: MatrixDraft, v: VariantDraft) => v.priceMinor !== computedPrice(draft, v.values);

// ------------------------------------------------------------------------------------------------ counts

const hasValue = (v: VariantDraft, option: string, key: string) => v.values[option] === key;

export const variantsWith = (draft: MatrixDraft, option: string, key: string) => draft.variants.filter((v) => hasValue(v, option, key));
export const unitsWith = (draft: MatrixDraft, option: string, key: string) => variantsWith(draft, option, key).reduce((n, v) => n + v.onHand, 0);
export const totalUnits = (draft: MatrixDraft) => draft.variants.reduce((n, v) => n + v.onHand, 0);
export const availableOf = (v: VariantDraft) => Math.max(v.onHand - v.reserved, 0);

export type StockLevel = "out" | "low" | "ok";
export function stockLevel(v: VariantDraft): StockLevel {
  const available = availableOf(v);
  if (available <= 0) return "out";
  return available <= LOW_STOCK_AT || (v.lowStockThreshold !== null && available <= v.lowStockThreshold) ? "low" : "ok";
}

// ------------------------------------------------------------------------------------------------ keys and SKUs

/** A URL-safe key for a value: `14"` → `14`, `13×6 HD` → `13x6-hd`. Unique among `taken`. */
export function keyFromLabel(label: string, taken: readonly string[] = []): string {
  const plain = label
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/["″”]/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const base = plain || "value";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base}-${n}`;
    if (!taken.includes(next)) return next;
  }
}

/** A SKU for a new combination, unique among the product's existing SKUs. */
export function skuFor(prefix: string, keys: readonly string[], existing: readonly string[]): string {
  const taken = new Set(existing.map((s) => s.toUpperCase()));
  const base = [prefix, ...keys].join("-").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 60);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base}-${n}`;
    if (!taken.has(next)) return next;
  }
}

/** The SKU prefix to continue with: what the product's existing SKUs share, else the first letters of its name. */
export function skuPrefix(draft: MatrixDraft, title: string): string {
  const first = draft.variants[0]?.sku.split("-")[0];
  if (first && draft.variants.every((v) => v.sku.split("-")[0] === first)) return first;
  return title.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 4).toUpperCase() || "SKU";
}

// ------------------------------------------------------------------------------------------------ editing

export type Edit<T = MatrixDraft> = { ok: true; draft: T; created?: VariantDraft[] } | { ok: false; reason: string };

const optionIndex = (draft: MatrixDraft, name: string) => draft.options.findIndex((o) => o.name === name);
/** Names that differ only by case, spacing or ×/x are the same name to a shopper. */
const plainLabel = (s: string) => s.trim().toLowerCase().replace(/×/g, "x").replace(/\s+/g, " ");
const sameLabel = (a: string, b: string) => plainLabel(a) === plainLabel(b);

/** Every mix of the other options' values (all of them, hidden ones included: those variants are simply inactive). */
function mixes(draft: MatrixDraft, except: string): Record<string, string>[] {
  return draft.options
    .filter((o) => o.name !== except)
    .reduce<Record<string, string>[]>((acc, o) => acc.flatMap((m) => o.values.map((v) => ({ ...m, [o.name]: v.key }))), [{}]);
}

/** How many variants adding a value to `option` would create. */
export const variantsCreatedByAdding = (draft: MatrixDraft, option: string) => mixes(draft, option).length;

export function addValue(draft: MatrixDraft, option: string, input: { label: string; deltaMinor: number; swatch?: string | null }, skuBase: string): Edit {
  const at = optionIndex(draft, option);
  if (at < 0) return { ok: false, reason: "That option does not exist." };
  const label = input.label.trim();
  if (!label) return { ok: false, reason: "Enter a name customers will see." };
  if (draft.options[at]!.values.some((v) => sameLabel(v.label, label))) return { ok: false, reason: `${label} already exists.` };
  if (draft.variants.length + variantsCreatedByAdding(draft, option) > MAX_VARIANTS) {
    return { ok: false, reason: `That would take this product past ${MAX_VARIANTS.toLocaleString("en-NG")} variants, the most one product can have.` };
  }
  const next = clone(draft);
  const key = keyFromLabel(label, next.options[at]!.values.map((v) => v.key));
  const value: ValueDraft = { key, label, deltaMinor: input.deltaMinor, swatch: input.swatch ?? null, active: true };
  next.options[at]!.values.push(value);
  const created: VariantDraft[] = [];
  const skus = next.variants.map((v) => v.sku);
  for (const mix of mixes(draft, option)) {
    const values = { ...mix, [option]: key };
    const keys = next.options.map((o) => values[o.name]!);
    const sku = skuFor(skuBase, keys, [...skus, ...created.map((c) => c.sku)]);
    const others = next.options.filter((o) => o.name !== option).every((o) => next.options.find((x) => x.name === o.name)!.values.find((v) => v.key === values[o.name])?.active);
    created.push({ sku, values, priceMinor: computedPrice(next, values), compareAtMinor: null, active: others, onHand: 0, reserved: 0, lowStockThreshold: null });
  }
  next.variants.push(...created);
  return { ok: true, draft: next, created };
}

export type ValuePatch = Partial<{ label: string; deltaMinor: number; swatch: string | null; active: boolean }>;

/**
 * Changes a value. Renaming keeps its key (so the store's links and past orders stay valid); a new price difference
 * reprices exactly the variants that have it, by the change; hiding stops those variants being sold, and showing
 * puts back the ones that have no other hidden value.
 */
export function editValue(draft: MatrixDraft, option: string, key: string, patch: ValuePatch): Edit {
  const at = optionIndex(draft, option);
  const value = draft.options[at]?.values.find((v) => v.key === key);
  if (!value) return { ok: false, reason: "That value does not exist." };
  if (patch.label !== undefined) {
    if (!patch.label.trim()) return { ok: false, reason: "Enter a name customers will see." };
    if (draft.options[at]!.values.some((v) => v.key !== key && sameLabel(v.label, patch.label!))) return { ok: false, reason: `${patch.label.trim()} already exists.` };
  }
  const next = clone(draft);
  const target = next.options[at]!.values.find((v) => v.key === key)!;
  if (patch.label !== undefined) target.label = patch.label.trim();
  if (patch.swatch !== undefined) target.swatch = patch.swatch;
  if (patch.deltaMinor !== undefined && patch.deltaMinor !== target.deltaMinor) {
    const change = patch.deltaMinor - target.deltaMinor;
    for (const v of next.variants) if (hasValue(v, option, key)) v.priceMinor += change;
    target.deltaMinor = patch.deltaMinor;
  }
  if (patch.active !== undefined && patch.active !== target.active) {
    target.active = patch.active;
    for (const v of next.variants) {
      if (!hasValue(v, option, key)) continue;
      v.active = patch.active ? next.options.every((o) => o.values.find((x) => x.key === v.values[o.name])?.active !== false) : false;
    }
  }
  return { ok: true, draft: next };
}

/** Removes a value and the variants that use it (the API retires them; orders keep their details). */
export function deleteValue(draft: MatrixDraft, option: string, key: string): Edit {
  const at = optionIndex(draft, option);
  const o = draft.options[at];
  if (!o?.values.some((v) => v.key === key)) return { ok: false, reason: "That value does not exist." };
  if (o.values.length === 1) return { ok: false, reason: `${option} needs at least one value. Add another first, or hide this one.` };
  const next = clone(draft);
  next.options[at]!.values = next.options[at]!.values.filter((v) => v.key !== key);
  next.variants = next.variants.filter((v) => !hasValue(v, option, key));
  return { ok: true, draft: next };
}

/** A new option: every existing variant takes its one value, so nothing is lost and prices stay as they are. */
export function addOption(draft: MatrixDraft, name: string, first: { label: string }): Edit {
  const n = name.trim();
  if (!n) return { ok: false, reason: "Enter a name for the option." };
  if (draft.options.some((o) => sameLabel(o.name, n))) return { ok: false, reason: `${n} already exists.` };
  if (draft.options.length >= MAX_OPTIONS) return { ok: false, reason: `A product can have at most ${MAX_OPTIONS} options.` };
  if (!first.label.trim()) return { ok: false, reason: "Enter the first value." };
  const key = keyFromLabel(first.label);
  const next = clone(draft);
  next.options.push({ name: n, values: [{ key, label: first.label.trim(), deltaMinor: 0, swatch: null, active: true }] });
  for (const v of next.variants) v.values[n] = key;
  return { ok: true, draft: next };
}

// ------------------------------------------------------------------------------------------------ variants

export type VariantFilters = { values: Record<string, string>; lowOnly: boolean };

/** The variants that pass the filters on the other options and the "low or out" toggle. */
export function filterVariants(draft: MatrixDraft, filters: VariantFilters): VariantDraft[] {
  return draft.variants.filter((v) => Object.entries(filters.values).every(([option, key]) => !key || v.values[option] === key) && (!filters.lowOnly || stockLevel(v) !== "ok"));
}

export type VariantGroup = { value: ValueDraft; all: VariantDraft[]; shown: VariantDraft[]; units: number; low: number };

/** Variants grouped under the first option's values (Length), each group with its counts. */
export function groupVariants(draft: MatrixDraft, filters: VariantFilters): VariantGroup[] {
  const first = draft.options[0];
  if (!first) return [];
  const visible = new Set(filterVariants(draft, filters));
  return first.values.map((value) => {
    const all = draft.variants.filter((v) => v.values[first.name] === value.key);
    return { value, all, shown: all.filter((v) => visible.has(v)), units: all.reduce((n, v) => n + v.onHand, 0), low: all.filter((v) => stockLevel(v) !== "ok").length };
  });
}

/** A variant's name in a group: its other options' labels joined with " · " (the first option is the group). */
export function variantName(draft: MatrixDraft, v: VariantDraft): string {
  return draft.options.slice(1).map((o) => o.values.find((x) => x.key === v.values[o.name])?.label ?? v.values[o.name]).join(" · ");
}

export function updateVariant(draft: MatrixDraft, index: number, patch: Partial<Pick<VariantDraft, "sku" | "priceMinor" | "active" | "onHand" | "lowStockThreshold" | "compareAtMinor">>): Edit {
  const next = clone(draft);
  const v = next.variants[index];
  if (!v) return { ok: false, reason: "That variant does not exist." };
  if (patch.sku !== undefined) {
    const sku = patch.sku.trim();
    if (!sku) return { ok: false, reason: "A variant needs a SKU." };
    if (next.variants.some((o, i) => i !== index && o.sku.toUpperCase() === sku.toUpperCase())) return { ok: false, reason: `${sku} is already used by another variant.` };
    v.sku = sku;
  }
  if (patch.priceMinor !== undefined) v.priceMinor = patch.priceMinor;
  if (patch.active !== undefined) v.active = patch.active;
  if (patch.onHand !== undefined) v.onHand = patch.onHand;
  if (patch.lowStockThreshold !== undefined) v.lowStockThreshold = patch.lowStockThreshold;
  if (patch.compareAtMinor !== undefined) v.compareAtMinor = patch.compareAtMinor;
  return { ok: true, draft: next };
}

/** A product with no options has a single variant; this makes one (price, stock, SKU) for a brand-new product. */
export function singleVariant(sku: string, priceMinor: number, onHand: number): MatrixDraft {
  return { options: [], variants: [{ sku, values: {}, priceMinor, compareAtMinor: null, active: true, onHand, reserved: 0, lowStockThreshold: null }] };
}

/** True when the draft differs from what was loaded, ignoring the order of things. */
export const isChanged = (a: MatrixDraft, b: MatrixDraft) => JSON.stringify(a) !== JSON.stringify(b);
