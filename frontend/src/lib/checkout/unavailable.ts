import { isApiError } from "@/lib/api/client";

/** One item the API says cannot be bought as asked, with what the customer needs to fix it. */
export type UnavailableItem = {
  variantId: string;
  /** The product's name, or null when it no longer exists. */
  name: string | null;
  /** `20" · HD`: the options they chose. */
  options: string;
  /**
   * NOT_FOR_SALE: hidden or switched off. REMOVED: no longer exists. SOLD_OUT: none left. NOT_ENOUGH: fewer left than
   * they asked for.
   */
  reason: "NOT_FOR_SALE" | "REMOVED" | "SOLD_OUT" | "NOT_ENOUGH";
  requested: number | null;
  available: number | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Reads the items out of a `VARIANT_UNAVAILABLE` or `OUT_OF_STOCK` error. Anything else gives none. */
export function unavailableItems(err: unknown): UnavailableItem[] {
  if (!isApiError(err) || (err.code !== "VARIANT_UNAVAILABLE" && err.code !== "OUT_OF_STOCK")) return [];
  const items: UnavailableItem[] = [];
  for (const d of err.details ?? []) {
    const o = (d ?? {}) as Record<string, unknown>;
    if (typeof o.variantId !== "string") continue;
    const available = num(o.availableQuantity);
    const reason: UnavailableItem["reason"] =
      err.code === "OUT_OF_STOCK" ? (available === 0 ? "SOLD_OUT" : "NOT_ENOUGH") : o.reason === "REMOVED" ? "REMOVED" : "NOT_FOR_SALE";
    items.push({ variantId: o.variantId, name: str(o.productTitle) || null, options: str(o.optionSummary), reason, requested: num(o.requestedQuantity), available });
  }
  return items;
}

/** "Bone Straight Wig (20" · HD)", or a plain phrase when the product can't be named. */
export const itemLabel = (item: UnavailableItem) => (item.name ? `${item.name}${item.options ? ` (${item.options})` : ""}` : "An item in your bag");

/** What is wrong with one item, in a sentence that names it. */
export function itemProblem(item: UnavailableItem): string {
  const label = itemLabel(item);
  switch (item.reason) {
    case "SOLD_OUT":
      return `${label} has just sold out.`;
    case "NOT_ENOUGH":
      return item.available !== null && item.requested !== null
        ? `Only ${item.available} of ${label} ${item.available === 1 ? "is" : "are"} left, and you asked for ${item.requested}.`
        : `${label} is no longer available in the quantity you chose.`;
    case "REMOVED":
      return item.name ? `${label} is no longer sold.` : "An item in your bag is no longer sold.";
    default:
      return `${label} is no longer available.`;
  }
}

/** What to do about it: the fix depends on the reason. */
export function itemAdvice(item: UnavailableItem): string {
  return item.reason === "NOT_ENOUGH" ? "Lower the quantity in your bag." : "Remove it from your bag to continue.";
}
