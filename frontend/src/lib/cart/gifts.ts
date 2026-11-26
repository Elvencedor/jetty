import type { GiftOffer } from "@/lib/api/types";
import { formatDate, formatDuration, formatNaira } from "@/lib/format";

/** What to say about the server's gift offers. Eligibility and amounts are the server's; this only words them. */

const SOON_MS = 48 * 60 * 60 * 1000;

/** An offer whose end has passed since the quote was made is no longer worth showing as one to earn. */
export const liveOffers = (offers: GiftOffer[], now: number): GiftOffer[] => offers.filter((o) => o.status === "unlocked" || !o.endsAt || Date.parse(o.endsAt) > now);

/** The line at the top: what has been earned, and how close the next gift is. */
export function giftHeadline(offers: GiftOffer[]): { title: string; note: string } {
  const earned = offers.filter((o) => o.status === "unlocked").length;
  const next = offers.find((o) => o.status === "locked");
  if (!next) {
    return earned === 1
      ? { title: "You’ve unlocked a free gift!", note: "It’s in your order at no cost." }
      : { title: `You’ve unlocked ${earned} free gifts!`, note: "They’re in your order at no cost." };
  }
  const a = earned ? "another" : "a";
  const note = earned === 0 ? "Grab it before you pay." : earned === 1 ? "1 free gift is already in your order." : `${earned} free gifts are already in your order.`;
  if (next.needs.qualifyingItem) return { title: `Unlock ${a} free gift`, note };
  if (next.needs.spendMinor > 0) return { title: `You’re ${formatNaira(next.needs.spendMinor)} away from ${a} free gift`, note };
  return { title: `${earned ? "Another" : "A"} free gift is waiting for you`, note };
}

/** "Bob wigs or Frontals": what counts, or null when everything does. */
export function qualifyingNames({ qualifying }: GiftOffer): string | null {
  if (qualifying.allProducts) return null;
  const names = [...qualifying.collections.map((c) => c.name), ...qualifying.products.map((p) => p.title)];
  if (names.length === 0) return "selected items";
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} and more` : names.join(" or ");
}

/** The one thing to do next to get a locked gift. */
export function giftAction(offer: GiftOffer): string {
  const { needs } = offer;
  const names = qualifyingNames(offer);
  if (needs.qualifyingItem) {
    const what = names ?? "another item";
    return needs.spendMinor > 0 ? `Spend ${formatNaira(needs.spendMinor)} on ${what} to get it free` : `Add ${what} to get it free`;
  }
  if (needs.spendMinor > 0) return `Add ${formatNaira(needs.spendMinor)} more${names ? ` of ${names}` : ""} to get it free`;
  return "Sign in to claim it";
}

export type GiftLink = { href: string; label: string };

/** Where to go to earn it: sign in when that is all that is left, otherwise to the things that count. */
export function giftLink(offer: GiftOffer, returnTo: string): GiftLink {
  const { needs, qualifying } = offer;
  if (needs.signIn && !needs.qualifyingItem && needs.spendMinor === 0) return signInLink(returnTo);
  const collection = qualifying.collections[0];
  if (collection) return { href: `/shop/${collection.slug}`, label: `Shop ${collection.name}` };
  const product = qualifying.products[0];
  if (product) return { href: `/p/${product.slug}`, label: qualifying.products.length === 1 ? "View the item" : "View an item" };
  return { href: "/shop", label: "Add more items" };
}

export const signInLink = (returnTo: string): GiftLink => ({ href: `/account/sign-in?next=${encodeURIComponent(returnTo)}`, label: "Sign in" });

/** The honest reasons to hurry: a real end date and real scarcity, as the server reports them. */
export function giftUrgency(offer: GiftOffer, now: number): string[] {
  const left = offer.endsAt ? Date.parse(offer.endsAt) - now : null;
  return [
    ...(left !== null && left > 0 ? [left < SOON_MS ? `Ends in ${formatDuration(Math.max(left, 60_000))}` : `Ends ${formatDate(offer.endsAt!)}`] : []),
    ...(offer.leftCount !== null ? [`Only ${offer.leftCount} left`] : []),
  ];
}
