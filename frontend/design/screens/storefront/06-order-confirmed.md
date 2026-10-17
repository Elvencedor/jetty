# Handoff spec: Order confirmed & tracking (B06)

Canvas artboard: `B06 · Order confirmed & tracking` · reference: [`reference/PinkConfirmation.dc.html`](../../reference/PinkConfirmation.dc.html)
Routes: `/order/[orderNumber]/confirmed` (right after payment), `/track` (guest lookup: order number + phone, `POST /orders/track`), `/account/orders/[id]` (signed in) · Data: `GET /checkout/{orderId}/status`, `GET /me/orders/{id}` · Features: ORD-01…10, ACC-03, REV-07

## Overview
Celebrates, reassures ("money taken, order safe, here's when it arrives") and keeps the shopper engaged after the purchase: tracking, install help, saving an account. The same tracker component is reused on the tracking and order-detail pages.

## Layout (mobile)
1. **Celebration hero** (`primary` fill, bottom corners `rounded-2xl`, two decorative circles in `pink-500`/`pink-700`, `aria-hidden`): logo wordmark + close (→ home); 64px white tile with a check; "Yay, it's yours, Adaeze!" (display-xl, white); "Order **#JH-10482** is confirmed. Receipt sent to email and WhatsApp." (white, not #FFE0EC); ETA card (white): "ARRIVING" overline, "Today, 4–8pm" (display 800, 24), status pill.
2. **OrderTracker** (horizontal, 5 steps).
3. **Rider card** (`surface-tint`): map area (P2; until then show a static area illustration or hide it), rider avatar, "Musa is on the way", "About 35 min away · phone", call IconButton (`tel:`). Before dispatch: "Packing at our Lekki studio", "A rider is assigned once packed", no call button.
4. Buttons: "Edit order · 30 min" (outline, P2 ORD-07; hide at launch) and "WhatsApp help" (dark).
5. **What's coming**: 4 thumbnails, "Paid with card ··4821 · ₦251,050", savings banner.
6. **How was checkout?** 5-star radio (P2 ORD-10).
7. **Get ready for install day**: horizontal cards (video tutorial on ink, care guide on tint), chosen by product type.
8. **Save your details** (ink card, guests only, ACC-03): "Reorder your exact wig in one tap", body, password field, primary "Create account". Success: "Account created. Find this order under Me › Orders." (`role="status"`).

## States
| Status (from API) | Hero/ETA | Tracker | Rider card |
|---|---|---|---|
| `placed` / `paid` | "Today, 4–8pm" · Paid | 2 steps done | Packing |
| `packed` | same · Packed | 3 | Packing, rider pending |
| `out_for_delivery` | ETA from courier · On the way | 4 | Rider details + call |
| `delivered` | "Delivered" · Delivered | 5 | Hidden; show "Leave a review" card instead |
| `pending_payment` (transfer) | "Waiting for your transfer" (warning) | 0 | Hidden |
| `cancelled` / `refunded` | Neutral hero (ink, not pink), reason text | — | Hidden |

The page polls the status every 30s while visible and the order is not final.

## Edge cases
- Opened from an emailed link by a guest: requires the checkout access cookie or the `/track` lookup; otherwise show the lookup form.
- Pickup orders: the rider card becomes "Ready for pickup at [Showroom address]" with a map link and opening hours.
- Long names: the hero greeting uses the first name only.

## Accessibility
- Focus the hero heading on load; announce "Order confirmed" (`role="status"`).
- The tracker is an `<ol>` with `aria-label="Order progress"`; the current step has `aria-current="step"`.
- Decorative hero circles are `aria-hidden`.
