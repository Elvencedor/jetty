# Handoff spec: Bag (B04)

Canvas artboard: `B04 · Bag` · reference: [`reference/PinkCart.dc.html`](../../reference/PinkCart.dc.html)
Route: `/bag` · Data: client-owned cart (localStorage + cookie), `POST /pricing/quote`, `GET /promotions/available` (P1) · Features: CART-01…10, PROMO-01…12

## Overview
Shows what the shopper is getting and why it's a good deal. Promotions are visible and explained ("You're saving ₦117,950"), and checkout is one tap away. Per docs/README.md, **the client owns the cart; the server prices it**. Every change re-quotes.

## Layout (mobile; page background `surface-tint`)
1. Header: back IconButton, "My bag **3**" (count in `primary`), wishlist IconButton.
2. **DealTracker** (ink card): BOGO progress, free-delivery progress ("Add ₦X for free delivery"), gift status.
3. **Line items** (white cards, `rounded-lg`): 84×100 image, name (700, 2 lines), variant summary (`muted`), badge (FREE · Buy 1 Get 1 / Buy 1 Get 1 ✓ / "Add 1 more bob → 1 free"), QuantityStepper, price (struck "was" when discounted). Trash IconButton top-right. **Gift lines** (free bonnet) have no stepper or trash, a "FREE GIFT" badge and "₦0".
4. **Offers for you**: CouponTicket list (from `/promotions/available`) + free-text code entry.
5. **Summary** card: PriceSummary `bag` with the savings banner.
6. Reassurance line: "Secure checkout · 7-day returns · Help on WhatsApp".
7. **Sticky checkout bar** (floating ink pill): "Total ₦251,050" + primary "Checkout →".

## States and interactions
| Element | State | Behaviour |
|---|---|---|
| Quantity +/− | Change | Optimistic update → re-quote (debounce 300ms) → reconcile. On a stock error, revert and show an inline note on the line |
| Trash | Remove | Remove the line with a 5s "Removed · Undo" inline row in its place |
| Coupon ticket | Apply | Re-quote with the code; success → ticket selected; failure → inline reason from the API (`PROMO_NOT_ELIGIBLE`, `PROMO_EXPIRED`, `PROMO_NOT_COMBINABLE`) |
| Code input | Submit | Same as above; Enter submits; uppercase on display |
| Gift line | Eligibility lost (wig removed) | The gift disappears with the quote; the DealTracker row flips to "Add a frontal wig for a free bonnet" |
| Summary | Re-quoting | Numbers dim to 50%, `aria-busy` |
| Checkout | Tap | Go to `/checkout`; disabled while quoting or if any line is unavailable |

## Edge cases
- **Empty bag**: illustration-free EmptyState "Your bag is empty", "Shop wigs" primary button, and the 4 Jetty's picks below.
- **Price changed since added**: the quote returns `priceChanged`; show a `warning` note on the line: "Price updated from ₦215,000".
- **Item no longer sold / out of stock**: line greyed, "No longer available" + Remove; checkout disabled until resolved.
- **Quote expired** (`expiresAt`): silently re-quote on focus or visibility change.
- **Stacking conflict**: the ticket for a non-combinable code shows "Can't be combined with Buy 1 Get 1" and stays unapplied.

## Accessibility
- Each line is an `<article>` labelled by the product name.
- The quote result is announced: "Total ₦251,050. You're saving ₦117,950" (`role="status"`).
- The sticky bar's total is not a live region (avoid double announcements).
