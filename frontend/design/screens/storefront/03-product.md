# Handoff spec: Product detail (B03)

Canvas artboard: `B03 · Product detail` · reference: [`reference/PinkProduct.dc.html`](../../reference/PinkProduct.dc.html)
Route: `/p/[slug]` · Data: `GET /products/{slug}`, `GET /products/{id}/reviews`, `POST /pricing/quote` (for the selected variant), `POST /delivery/quotes` (ETA) · Features: PDP-01…18, REV-01…06

## Overview
The most important screen. Wigs have up to 5 options (colour, length, lace, density, cap size), so choosing must feel guided, not like a form. The design uses a **"Build your wig" stepper accordion**: one option open at a time, each row showing the chosen value. A live summary card shows the full choice and price.

## Layout (mobile)
1. **Full-bleed gallery** (500px tall). Floating IconButtons: back (top-left); share and wishlist (top-right). Angle chips above the bottom edge (Front, Side, Back, Lace, Worn, 360°; selected = ink pill) plus a zoom IconButton. Swipe also changes images. 360° opens a full-screen spin viewer (PDP-03, P2; hide the chip until frames exist).
2. **Content sheet** overlaps the gallery by 32px (`rounded-xl` top corners, white).
3. **Badges row**: sale %, "Free bonnet gift", "Same-day Lagos". These come from the quote's promotions and delivery eligibility.
4. **Title** (heading-lg, ≤ 3 lines) + rating link ("★ 4.9" ink pill + "312 reviews" underlined + "· 1.2k sold") that jumps to Reviews.
5. **Live summary card** (`surface-tint`): "YOUR WIG" overline, the summary string `20" · 13×4 HD · 180% · 1B · M`, and on the right the struck "was" price and the current price (display 800, 22).
6. **Build your wig**: 5 rows (Colour, Length, Lace, Density, Cap size). Each row header is 58px: a number badge (`primary` when open), title, chosen value in `primary-strong`, chevron. When open: choice chips (swatches for colour; "+₦25k"/"Included" notes for lace; sold-out chips struck through) and an optional help link ("See lengths on a 5′5″ model", "Measure your head in 1 minute" → size guide).
7. **Delivery estimate** (dashed `line-accent` card): truck icon, "Get it **today by 8pm** in Lekki. Order within **3h 20m**." plus a Change link (opens the location picker).
8. **Install bundle** (ink card, P2 PDP-15): checklist of the wig, bonnet and tint with prices, "Save 10%", total, and an "Add bundle" button (white).
9. **Info tabs** (PillTabs): Details · Fit · Care · Delivery. Content uses `ink-soft` and keeps line breaks.
10. **Reviews**: "4.9" display + attribute chips (True to length 96% …), a photo strip, review cards in a horizontal scroll (270 wide), and "See all 312 reviews · 14 questions" (outline).
11. **Sticky add-to-bag bar**: QuantityStepper + primary "Add to bag · ₦203,000". Above it an inline success row "Added to bag · View bag" (`success-bg`) for 6s or until the selection changes.

## Variant logic (important)
- Option values, price add-ons and availability come from `GET /products/{slug}` (`options[]`, `variants[]`). Never derive price on the client; request `POST /pricing/quote` for the selected variant and show its `unitPrice`, `compareAt` and promotion messages. Debounce 150ms; while waiting, dim the price.
- **Unavailable combinations**: when a value has no in-stock variant given the other choices, show it disabled (struck through) with `aria-label="… sold out"` and a "Notify me" link (PDP-06). If the shopper's current selection becomes unavailable after changing another option, keep it selected, mark the summary "Sold out" and swap the CTA for "Notify me when back".
- **Default selection**: the best-selling variant (from the API) is preselected, so the price shows immediately and the bag can be filled in one tap.
- Opening a step closes the others; choosing a value auto-advances to the next step after 250ms (except the last). Users can reopen any step.

## States and interactions
| Element | State | Behaviour |
|---|---|---|
| Add to bag | Loading | Button spinner; the stepper stays usable |
| Add to bag | Success | Inline success row (`role="status"`); bag badge bumps; no modal, no navigation |
| Add to bag | Error (stock gone) | Inline `danger` row: "Only 1 left in this length. We've set quantity to 1." |
| Quantity | Max | Disable + at min(stock, 5) |
| Gallery | Swipe/keyboard | ←/→ keys change image; chips stay in sync |
| Zoom | Tap | Full-screen pinch-zoom viewer; close returns focus |
| Bundle | Toggle item | Recalculate via quote; "Add bundle" adds the checked items |
| Tabs | Select | Swap content; keep height to avoid layout jump (min-height) |

## Edge cases
- Product with 1 option (care items): hide the stepper; show the quantity and the CTA only.
- Option with many values (lengths 10–40"): chips wrap; never horizontal scroll.
- Hidden (archived) value in the admin: don't show it to customers.
- No reviews: "Be the first to review" card, with no stars shown.
- Promotion ends while on page: the next quote removes the badge and the price updates; show a subtle note "Price updated".
- Long product name: 3 lines max in the title, full text in `<title>`.

## Accessibility
- Each step is an accordion button with `aria-expanded` controlling a region labelled by the step title.
- Chips are `aria-pressed` buttons; swatches have colour names.
- The price change is announced politely ("Price ₦228,000") with `aria-live="polite"` on the summary price only.
- The sticky bar must not cover the focused element: add `scroll-padding-bottom: 110px` on `html`.
