import type { CartLine } from "@/lib/stores/cart";
import type { Quote, QuoteLine, RejectedCode } from "@/lib/api/types";

/** A bag line as shown: what the shopper holds, matched with the server's priced line and any problem with it. */
export type LineProblem = { kind: "gone" } | { kind: "short"; available: number };
export type LineView = { variantId: string; quantity: number; priced?: QuoteLine; problem?: LineProblem };

/**
 * Joins the client's bag with the server's quote. A variant the quote does not price is no longer sold; a stock
 * warning means the requested quantity is more than is left (zero left counts as gone).
 */
export function buildLineViews(lines: CartLine[], quote: Quote | undefined): LineView[] {
  if (!quote) return lines.map((l) => ({ ...l }));
  // A free gift can be the same variant as something in the bag; only the lines the shopper added match their bag.
  const priced = new Map(quote.lines.filter((l) => !l.gift).map((l) => [l.variantId, l]));
  const stock = new Map<string, number>();
  for (const w of quote.warnings) if (w.code === "OUT_OF_STOCK" || w.code === "INSUFFICIENT_STOCK") stock.set(w.variantId, w.availableQuantity);
  return lines.map((l) => {
    const line = priced.get(l.variantId);
    if (!line) return { ...l, problem: { kind: "gone" } };
    const available = stock.get(l.variantId);
    if (available === 0) return { ...l, priced: line, problem: { kind: "gone" } };
    if (available !== undefined) return { ...l, priced: line, problem: { kind: "short", available } };
    return { ...l, priced: line };
  });
}

/** The free gifts the offers have added to this bag. */
export const giftLines = (quote: Quote | undefined): QuoteLine[] => quote?.lines.filter((l) => l.gift) ?? [];

/** Checkout needs a settled quote and every line buyable as it stands. */
export function canCheckout(views: LineView[], quote: Quote | undefined, busy: boolean): boolean {
  return !busy && !!quote && views.length > 0 && views.every((v) => !v.problem);
}

/** What to tell a shopper whose code was not applied. */
export const REJECTION_MESSAGES: Record<RejectedCode["reason"], string> = {
  INVALID_CODE: "That code isn't valid.",
  EXPIRED: "That code has expired.",
  USAGE_LIMIT_REACHED: "That code has been used up.",
  NOT_ELIGIBLE: "Sign in to use this offer.",
  MIN_SPEND_NOT_MET: "Your bag doesn't reach the minimum spend for this code.",
  NOT_APPLICABLE: "That code doesn't apply to what's in your bag.",
};

export const rejectionMessage = (reason: RejectedCode["reason"]) => REJECTION_MESSAGES[reason] ?? "That code can't be used.";

/** Total units across lines. */
export const unitCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);
