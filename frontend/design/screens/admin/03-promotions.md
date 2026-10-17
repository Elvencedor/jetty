# Handoff spec: Admin · Promotions (B-A3)

Reference: [`reference/PinkAdminPromotions.dc.html`](../../reference/PinkAdminPromotions.dc.html) · Route: `/admin/promotions`, builder `/admin/promotions/new` and `/admin/promotions/{id}` · Data: `GET/POST/PATCH /admin/promotions`, `/activate`, `/deactivate`, `GET /admin/analytics/promotions` (P1) · Features: PROMO-01…14, PADM-01…06

## Overview
Lets a non-technical owner create coupons, discounts, BOGO, gifts and free delivery without making mistakes, and see what is running when.

## Layout
1. Header: "Promotions & storefront", "3 live · 1 scheduled · 6 ended".
2. **Campaign calendar** (card, P2 PADM-05): month grid (31 day columns, today highlighted in `primary`), one row per promotion: name and kind on the left, a pill bar spanning its dates (Live = `primary`, Scheduled = blush, Ended = neutral). Scrolls horizontally under 760px. Clicking a bar opens that promotion.
3. **Builder** (card, left) + **Live preview** (right, 280px phone frame):
   - Wizard steps as pills: **1 Type · 2 Rule · 3 Who & limits · 4 Schedule** (each clickable; current = ink).
   - **Type**: 5 radio cards with a large glyph: % Percentage off · ₦ Fixed amount · 1+1 Buy X get Y · ♡ Free gift · → Free delivery.
   - **Rule**: a **plain-English sentence** with editable tokens, e.g. "Buy **1 bob wig**, get **1 bob wig** free (the cheaper one)." Tapping a token opens a small picker (collection/product/quantity/amount). Below: "Customers get it" SegmentedControl Automatically / With a code (+ code input with Generate).
   - **Who & limits**: Who (Everyone, First order only, Returning, VIP segment [P1]), Minimum spend, Total uses, Per customer, "Can stack with" checkboxes (Other codes, Free delivery, Gifts, Sale prices).
   - **Schedule**: Starts / Ends (date-time, WAT) and "Promote it on the storefront" placement chips (Announcement bar, Home hero card, Story circle, Product badge, In-feed shop card), which create linked storefront content.
   - Footer: Back · Next / "Schedule promotion" (or "Start now" when the start time ≤ now).
   - **Preview** updates live: announcement bar text, hero card, bag line with struck price and the discount line, generated from the same rule.
4. **Homepage slots** card with an "Open storefront editor" link (the full editor is B-A6).

## Validation
- Percentage 1–90; fixed amount > 0 and < the cheapest eligible product (warn otherwise).
- End after start; warn if it overlaps a non-stackable promotion on the same products (show which one).
- Code: A–Z, 0–9, 4–20 characters, unique.

## States
| Element | State | Behaviour |
|---|---|---|
| Promotion row | Live | Editing the rule while live shows "Changes apply to new baskets immediately" |
| Builder | Leaving with changes | Discard prompt |
| Schedule | Success | Toast "FLASH15 scheduled for Oct 24, 00:00"; the calendar updates |

## Accessibility
- The rule sentence tokens are buttons with full labels ("Change what customers buy: 1 bob wig").
- The wizard uses `aria-current="step"`; each step panel heading receives focus.
