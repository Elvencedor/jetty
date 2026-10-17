# Jetty's Hair — Feature Inventory

Every feature implied by the approved designs (Option A "Luxe editorial" and Option B "Pink pop" share the same feature set; only the visual layer differs).

**Priority key**
- **P0**: needed to launch (take real orders end to end)
- **P1**: soon after launch (conversion and ops polish)
- **P2**: later or nice to have

IDs are stable so tickets can reference them (e.g. `PROMO-04`).

---

## 1. Platform foundations

| ID | Feature | Priority |
|---|---|---|
| PLAT-01 | Monorepo: customer storefront app, admin app, shared UI/design-token package, shared API/domain package | P0 |
| PLAT-02 | Theming via design tokens so the storefront can switch between Option A and Option B (or a future brand) without code changes | P1 |
| PLAT-03 | Mobile-first responsive layouts, 44px minimum touch targets | P0 |
| PLAT-04 | Image pipeline: upload, resize, WebP/AVIF, CDN delivery, lazy loading, blur placeholders | P0 |
| PLAT-05 | Currency formatting in Naira (₦), with the data model ready for multi-currency | P0 |
| PLAT-06 | Environment config, secrets management, staging and production environments | P0 |
| PLAT-07 | Background jobs/queue (emails, WhatsApp, stock sync, scheduled promotions) | P0 |
| PLAT-08 | Feature flags | P2 |

## 2. Customer accounts

| ID | Feature | Priority |
|---|---|---|
| ACC-01 | Guest checkout (no account required) | P0 |
| ACC-02 | Sign up / log in with email + password, or phone + OTP | P0 |
| ACC-03 | Create account after purchase from the confirmation page (convert a guest order) | P1 |
| ACC-04 | Password reset | P0 |
| ACC-05 | Address book (multiple addresses, default address, landmark/rider note) | P1 |
| ACC-06 | Saved payment cards (tokenised by the payment provider, never stored by us) | P1 |
| ACC-07 | Order history and order detail | P0 |
| ACC-08 | "Reorder my exact wig": saved length, density, lace, colour and cap size | P2 |
| ACC-09 | Communication preferences (email, WhatsApp, marketing opt-in) | P1 |
| ACC-10 | Social login (Google/Apple) | P2 |

## 3. Discovery: home, browse, search

| ID | Feature | Priority |
|---|---|---|
| DISC-01 | Homepage built from admin-managed sections (see CMS-*) | P0 |
| DISC-02 | Category and collection pages (Frontal, Closure, Glueless, Bobs, Coloured, Hair care, Accessories) | P0 |
| DISC-03 | Breadcrumbs | P0 |
| DISC-04 | Product search with type-ahead suggestions | P0 |
| DISC-05 | Search synonyms and typo tolerance ("bob", "26 inch", "glueless") | P1 |
| DISC-06 | Filters: texture, lace type, length, density, colour, price range, in stock, on offer | P0 |
| DISC-07 | Active filter chips with remove and "clear all" | P0 |
| DISC-08 | Sorting: recommended, best selling, newest, price, top rated | P0 |
| DISC-09 | Grid/list view toggle | P2 |
| DISC-10 | Pagination or "load more" with a progress indicator | P0 |
| DISC-11 | Shop by texture, shop by length entry points | P1 |
| DISC-12 | Product cards: badges (sale %, BOGO, New, Featured, Low stock), rating, price/was-price, colour swatches, length range, quick add | P0 |
| DISC-13 | Wig-finder quiz (four questions, then a recommended wig) | P2 |
| DISC-14 | Recently viewed products | P2 |

## 4. Product detail page (PDP)

| ID | Feature | Priority |
|---|---|---|
| PDP-01 | Multi-angle image gallery (front, side, back, hairline close-up, worn, scale) with thumbnails | P0 |
| PDP-02 | Pinch/tap zoom | P0 |
| PDP-03 | 360° spin viewer (enabled when there are 24+ frames) | P2 |
| PDP-04 | Variant selection: colour, length, lace, density, cap size | P0 |
| PDP-05 | Price that updates live from the variant (base price + option add-ons) | P0 |
| PDP-06 | Sold-out variants shown disabled, with "notify me when back" | P0 (disable) / P1 (notify) |
| PDP-07 | Sale price and savings shown | P0 |
| PDP-08 | Promotion messaging pulled from the live rules (e.g. "Free bonnet with this wig") | P0 |
| PDP-09 | Quantity selector and add to bag with confirmation (no blocking modal) | P0 |
| PDP-10 | Sticky add-to-bag bar on mobile | P1 |
| PDP-11 | Delivery estimate with a same-day cutoff countdown, based on location | P1 |
| PDP-12 | Cap size guide / measuring help | P0 |
| PDP-13 | Details, fit, care and delivery/returns info (accordion or tabs) | P0 |
| PDP-14 | "Complete the install" add-ons (manual picks or automatic) | P1 |
| PDP-15 | Bundle with a discount (wig + bonnet + tint) | P2 |
| PDP-16 | Wishlist / save | P1 |
| PDP-17 | Share | P2 |
| PDP-18 | Instalment message ("3 payments of …") | P2 |

## 5. Reviews and social proof

| ID | Feature | Priority |
|---|---|---|
| REV-01 | Verified-buyer reviews: star rating, title, body, variant bought, location | P0 |
| REV-02 | Rating summary with a star breakdown | P0 |
| REV-03 | Photo reviews (customer uploads) | P1 |
| REV-04 | Review filters: with photos, same length, most helpful | P1 |
| REV-05 | "Helpful" votes | P2 |
| REV-06 | Attribute stats (true to length %, lace melts %, low shedding %) | P2 |
| REV-07 | Review request sent automatically 7 days after delivery | P1 |
| REV-08 | Q&A on the product page | P2 |
| REV-09 | UGC gallery (#JettysHair) linking each look to its product | P2 |

## 6. Wishlist

| ID | Feature | Priority |
|---|---|---|
| WISH-01 | Save/unsave from cards and the PDP; guest wishlist merged on login | P1 |
| WISH-02 | Wishlist page with move-to-bag | P1 |
| WISH-03 | Price-drop / back-in-stock alerts for saved items | P2 |

## 7. Bag (cart)

| ID | Feature | Priority |
|---|---|---|
| CART-01 | Client-side persistent bag (guest/customer browser storage; merge guest items into the signed-in customer's local bag on login) | P0 |
| CART-02 | Line items with variant summary, quantity +/−, remove | P0 |
| CART-03 | Promotions applied automatically and shown per line (BOGO free item, free gift line) | P0 |
| CART-04 | Coupon code entry with clear success and error states | P0 |
| CART-05 | Available-offers list (tap to apply) | P1 |
| CART-06 | Progress towards free delivery or the next deal ("add 1 more bob → 1 free") | P1 |
| CART-07 | Cost breakdown: subtotal, each discount, gift, delivery, total, "you're saving ₦X" | P0 |
| CART-08 | Small upsell in the bag ("often bought with your wig") | P1 |
| CART-09 | Stock re-checked on bag view and at checkout | P0 |
| CART-10 | Abandoned-bag recovery (email/WhatsApp) | P1 |

## 8. Pricing and promotions engine (shared by bag, checkout and admin)

| ID | Feature | Priority |
|---|---|---|
| PROMO-01 | Percentage-off discounts | P0 |
| PROMO-02 | Fixed-amount discounts | P0 |
| PROMO-03 | Buy X get Y (BOGO): free or % off, cheapest item free, by collection or product | P0 |
| PROMO-04 | Free gift with purchase (auto-added gift line) | P1 |
| PROMO-05 | Free delivery by zone and/or minimum spend | P0 |
| PROMO-06 | Automatic promotions vs code-based coupons | P0 |
| PROMO-07 | Scope: all products, collections, specific products, exclusions | P0 |
| PROMO-08 | Eligibility: minimum spend, first order only, customer segment | P0 (min spend, first order) / P1 (segments) |
| PROMO-09 | Usage limits: total and per customer | P0 |
| PROMO-10 | Stacking rules (what combines with what), resolved deterministically | P0 |
| PROMO-11 | Scheduling (start/end, auto-activate/expire) and a countdown for flash deals | P0 (schedule) / P1 (countdown) |
| PROMO-12 | Single pricing service: the storefront badge, the bag and the charged total always agree | P0 |
| PROMO-13 | Code generator and bulk/unique codes | P2 |
| PROMO-14 | Per-promotion reporting (orders, revenue, redemptions) | P1 |

## 9. Checkout and payments (Nigeria)

| ID | Feature | Priority |
|---|---|---|
| CHK-01 | Checkout flow: contact → delivery → payment → review (single page or steps) | P0 |
| CHK-02 | Collapsible order summary throughout checkout | P0 |
| CHK-03 | Address entry with state/area, landmark and rider note | P0 |
| CHK-04 | Delivery options: same-day Lagos (cutoff time), next day, nationwide 2–4 days, showroom pickup; zone-based rates | P0 |
| CHK-05 | Card payment through a payment gateway (Visa, Mastercard, Verve) | P0 |
| CHK-06 | Bank transfer with a one-time account number and auto-confirmation | P0 |
| CHK-07 | USSD payment | P1 |
| CHK-08 | Pay on delivery (Lagos only, rule-based) | P1 |
| CHK-09 | Express checkout (saved card, pay with bank app) | P1 |
| CHK-10 | Payment webhooks, idempotency, and handling of pending/failed payments | P0 |
| CHK-11 | Form validation and Nigerian phone number formatting | P0 |
| CHK-12 | Trust signals: secure badges, returns policy, terms consent | P0 |
| CHK-13 | Persist a pending-payment order snapshot before Paystack initialization; move it to placed/fulfillable only after verified payment (bank transfer remains pending until confirmed) | P0 |
| CHK-14 | Instalment / pay-later partner | P2 |

## 10. Orders and post-purchase

| ID | Feature | Priority |
|---|---|---|
| ORD-01 | Order confirmation page with order number, ETA and recap | P0 |
| ORD-02 | Confirmation receipt by email | P0 |
| ORD-03 | Order updates on WhatsApp/SMS | P1 |
| ORD-04 | Order status timeline: pending payment → paid/placed → packed → out for delivery → delivered | P0 |
| ORD-05 | Tracking page (with guest lookup by order number + phone) | P0 |
| ORD-06 | Rider details and call button; live map | P1 (rider) / P2 (map) |
| ORD-07 | Customer can edit or cancel within a 30-minute window | P2 |
| ORD-08 | Returns/exchange request flow (7 days, unworn, lace uncut) | P1 |
| ORD-09 | Post-purchase content (install video, care guide) | P1 |
| ORD-10 | Checkout satisfaction rating | P2 |

## 11. Storefront content and merchandising (admin-managed)

| ID | Feature | Priority |
|---|---|---|
| CMS-01 | Announcement bar: several messages, scheduling, on/off, rotation | P0 |
| CMS-02 | Hero banner carousel/cards: image, headline, CTA link, schedule, order | P0 |
| CMS-03 | Featured products section ("Featured this week" / "Jetty's picks"), drag to order, max count | P0 |
| CMS-04 | Story circles / quick links to collections | P1 |
| CMS-05 | In-feed promo cards on listing pages | P1 |
| CMS-06 | Homepage section manager (turn sections on/off, reorder) | P1 |
| CMS-07 | Product badges: automatic (sale/BOGO/new/low stock) or manual override | P0 |
| CMS-08 | Upsell rules (PDP add-ons, bag upsell) | P1 |
| CMS-09 | Static pages: FAQs, returns, size guide, care guide, terms, privacy, contact | P0 |
| CMS-10 | Newsletter / WhatsApp opt-in capture (inline only, never a pop-up) | P1 |
| CMS-11 | Click tracking per banner/placement (CTR) | P1 |

## 12. Admin portal

### 12.1 Access and team

| ID | Feature | Priority |
|---|---|---|
| ADM-01 | Admin login with 2FA | P0 |
| ADM-02 | Roles and permissions (owner, manager, fulfilment, content editor, support) | P1 |
| ADM-03 | Team member invites and management | P1 |
| ADM-04 | Audit log of admin changes (prices, promotions, refunds) | P1 |

### 12.2 Dashboard and analytics

| ID | Feature | Priority |
|---|---|---|
| ANL-01 | KPIs: revenue, orders, average order value, conversion rate, with change vs the previous period | P0 |
| ANL-02 | Date range picker (7d, 30d, quarter, custom) | P0 |
| ANL-03 | Revenue over time chart with a previous-period comparison | P0 |
| ANL-04 | Shopping funnel (sessions → product view → add to bag → checkout → purchase) | P1 |
| ANL-05 | Top products, sales by category | P0 |
| ANL-06 | Promotion performance | P1 |
| ANL-07 | Customers: new vs returning, top states | P1 |
| ANL-08 | "Needs attention" alerts (low stock, reviews to moderate, promotions ending) | P1 |
| ANL-09 | Orders-to-action counts (to pack, out for delivery, awaiting transfer, returns) | P0 |
| ANL-10 | Automated insights ("biggest drop-off is…") | P2 |
| ANL-11 | CSV export | P1 |

### 12.3 Orders and fulfilment

| ID | Feature | Priority |
|---|---|---|
| OPS-01 | Order list with search, filters and status | P0 |
| OPS-02 | Order detail: items, payment, delivery, customer, timeline, notes | P0 |
| OPS-03 | Status updates that trigger customer notifications | P0 |
| OPS-04 | Manually confirm a bank transfer | P0 |
| OPS-05 | Assign a rider / delivery partner, with tracking info | P1 |
| OPS-06 | Refunds (full/partial) and returns processing | P1 |
| OPS-07 | Packing slip / invoice print | P1 |
| OPS-08 | Manual order creation (e.g. WhatsApp sales) | P2 |

### 12.4 Catalog and inventory

| ID | Feature | Priority |
|---|---|---|
| CAT-01 | Product list/grid with search and status filters (active, draft, out of stock) | P0 |
| CAT-02 | Product editor: title, description, category, tags, status, SEO fields | P0 |
| CAT-03 | Option builder (length, lace, density, colour, cap) with price add-ons per option | P0 |
| CAT-04 | Variant matrix: price, SKU and stock per variant; bulk edit | P0 |
| CAT-05 | Media manager: upload, reorder, cover image, 360° frame set | P0 (P2 for 360°) |
| CAT-06 | Featured toggle and badge setting per product | P0 |
| CAT-07 | Upsell/bundle item picker per product | P1 |
| CAT-08 | Collections/categories management | P0 |
| CAT-09 | Inventory tracking, low-stock thresholds and alerts | P0 |
| CAT-10 | CSV import/export | P1 |
| CAT-11 | Product preview before publishing | P1 |

### 12.5 Customers (users)

| ID | Feature | Priority |
|---|---|---|
| CUS-01 | Customer list with search, order count and lifetime value | P0 |
| CUS-02 | Customer profile: orders, addresses, notes, marketing consent | P1 |
| CUS-03 | Segments (VIP, first-time, lapsed) for promotions | P2 |
| CUS-04 | Block/disable an account; data export/delete on request (NDPR) | P1 |

### 12.6 Promotions (admin side of PROMO-*)

| ID | Feature | Priority |
|---|---|---|
| PADM-01 | Promotion list with status (live, scheduled, ended), usage and schedule | P0 |
| PADM-02 | Promotion builder (type → rule → who and limits → schedule) | P0 |
| PADM-03 | Plain-English rule summary | P1 |
| PADM-04 | Live customer preview (banner, badge, bag line) | P2 |
| PADM-05 | Campaign calendar showing overlaps | P2 |
| PADM-06 | Attach a promotion to placements (announcement, hero, badge, in-feed card) | P1 |

### 12.7 Reviews moderation

| ID | Feature | Priority |
|---|---|---|
| MOD-01 | Approve/reject/hide reviews and photos | P0 (with REV-01) |
| MOD-02 | Reply to reviews publicly | P2 |

### 12.8 Settings

| ID | Feature | Priority |
|---|---|---|
| SET-01 | Store details, contact info, WhatsApp number, showroom address | P0 |
| SET-02 | Delivery zones, rates, same-day cutoff, pickup locations | P0 |
| SET-03 | Payment method configuration | P0 |
| SET-04 | Notification templates (email, WhatsApp, SMS) | P1 |
| SET-05 | Policies (returns window, POD limits) | P0 |
| SET-06 | Tax/VAT settings | P1 |

## 13. Notifications

| ID | Feature | Priority |
|---|---|---|
| NOT-01 | Transactional email (order, payment, shipping, delivery, password reset) | P0 |
| NOT-02 | WhatsApp Business messages for order updates | P1 |
| NOT-03 | SMS fallback | P2 |
| NOT-04 | Admin alerts (new order, low stock, failed payment) | P1 |
| NOT-05 | Marketing campaigns (drops, back in stock) | P2 |

## 14. Cross-cutting quality

| ID | Feature | Priority |
|---|---|---|
| QA-01 | Performance budget: fast first load on mid-range Android over 3G/4G (SSR/ISR, code splitting) | P0 |
| QA-02 | SEO: clean URLs, metadata, Open Graph, product structured data, sitemap | P0 |
| QA-03 | Accessibility: WCAG 2.1 AA (contrast, keyboard, labels, screen readers) | P0 |
| QA-04 | Security: OWASP basics, rate limiting, CSRF, input validation, PCI scope kept with the gateway | P0 |
| QA-05 | Error tracking, logging and uptime monitoring | P0 |
| QA-06 | Product analytics events (view, add to bag, checkout steps, purchase) feeding ANL-* | P0 |
| QA-07 | Automated tests: unit (pricing engine first), integration (checkout and payments), E2E (purchase flow) | P0 |
| QA-08 | Data protection compliance (NDPR), cookie notice | P0 |
| QA-09 | Backups and disaster recovery | P0 |

---

## Suggested MVP cut (P0 only)

A customer can browse, search and filter, pick a variant, use a coupon and get BOGO/free delivery applied, pay by card or transfer, and track the order. An admin can manage products and variants, stock, orders, promotions, the homepage banners and featured row, and see core sales numbers.
