# Jetty's Hair — Design handoff (Option B · Pink pop)

This folder is the developer handoff for the storefront and admin portal. It covers the **Option B · "Pink pop"** design: 6 customer screens and 9 admin screens. Option A (Luxe editorial) is kept only as an alternative token theme (`[data-theme="luxe"]` in `tokens.css`), because the storefront editor lets the owner switch themes.

Design canvas (source of truth, private to the owner until shared): https://claude.ai/code/artifact/11cdfd4c-73f1-4619-8f97-08e5df443912 (open the "Option B · Pink pop" page).

## What's here

| File | What it is |
|---|---|
| [`tokens.css`](./tokens.css) | Tailwind 4 `@theme` tokens: colours, type scale, radius, shadow, motion, breakpoints. Ready to `@import`, **not wired in yet** |
| [`tokens.json`](./tokens.json) | The same tokens as JSON (for tests, Storybook, email templates) |
| [`01-foundations.md`](./01-foundations.md) | Colour roles and contrast, typography, spacing, shape, icons, imagery, motion, responsive rules, accessibility baseline |
| [`02-components.md`](./02-components.md) | Component inventory: variants, props, states, behaviour |
| [`screens/storefront/`](./screens/storefront) | Per-screen specs: Home, Shop, Product, Bag, Checkout, Order confirmed |
| [`screens/admin/`](./screens/admin) | Admin shell + Dashboard, Products & variants, Promotions, Orders, Customers, Storefront editor, Reviews, Team, Settings |
| [`reference/`](./reference) | The canvas source of each artboard (`*.dc.html`), for exact copy, spacing and interaction logic |

## Screen index

| Canvas | Spec | Route | P |
|---|---|---|---|
| B01 Home | [01-home](./screens/storefront/01-home.md) | `/` | P0 |
| B02 Shop / Listing | [02-shop](./screens/storefront/02-shop.md) | `/shop/[collection]`, `/search` | P0 |
| B03 Product detail | [03-product](./screens/storefront/03-product.md) | `/p/[slug]` | P0 |
| B04 Bag | [04-bag](./screens/storefront/04-bag.md) | `/bag` | P0 |
| B05 Checkout | [05-checkout](./screens/storefront/05-checkout.md) | `/checkout` | P0 |
| B06 Order confirmed & tracking | [06-order-confirmed](./screens/storefront/06-order-confirmed.md) | `/order/[n]/confirmed`, `/track` | P0 |
| — Admin shell | [00-admin-shell](./screens/admin/00-admin-shell.md) | `/admin/*` | P0 |
| B-A1 Dashboard | [01-dashboard](./screens/admin/01-dashboard.md) | `/admin` | P0 |
| B-A2 Products & variants | [02-products](./screens/admin/02-products.md) | `/admin/products` | P0 |
| B-A3 Promotions | [03-promotions](./screens/admin/03-promotions.md) | `/admin/promotions` | P0 |
| B-A4 Orders | [04-orders](./screens/admin/04-orders.md) | `/admin/orders` | P0 |
| B-A5 Customers | [05-customers](./screens/admin/05-customers.md) | `/admin/customers` | P0 list / P1 profile |
| B-A6 Storefront editor | [06-storefront-editor](./screens/admin/06-storefront-editor.md) | `/admin/storefront` | P0 core / P1 extras |
| B-A7 Reviews | [07-reviews](./screens/admin/07-reviews.md) | `/admin/reviews` | P0 |
| B-A8 Team & roles | [08-team](./screens/admin/08-team.md) | `/admin/team` | P1 |
| B-A9 Settings | [09-settings](./screens/admin/09-settings.md) | `/admin/settings/[section]` | P0 |

Feature IDs in the specs (e.g. `PDP-06`, `PROMO-03`) refer to [`docs/FEATURES.md`](../../docs/FEATURES.md); endpoints refer to [`docs/API.md`](../../docs/API.md).

## Getting started

1. **Tokens**: in `src/app/globals.css`, replace the default theme block with `@import "tailwindcss"; @import "../../design/tokens.css";`. Remove the dark-mode `:root` override; the design is light-only.
2. **Fonts**: swap Geist for Bricolage Grotesque + Figtree in `src/app/layout.tsx` (snippet in 01-foundations.md).
3. **Icons**: add `lucide-react`.
4. **Build order**: primitives (Button, IconButton, Chip, SegmentedControl, Switch, Input, Badge, StatusPill) → ProductCard, PriceSummary, SideDrawer, BottomSheet → storefront screens in purchase order → admin shell → admin screens.
5. **Money**: always `formatNaira(minor)` from `src/lib/api.ts`. All prices, discounts and delivery fees come from the API quote; the UI never calculates them.

## Decisions & differences from the canvas

These override what the mockups show:

1. **Card payment uses Paystack's popup/redirect.** The checkout mockup's card number/expiry/CVV fields must not be built (PCI scope; docs/README.md §5). Transfer and USSD also run through Paystack channels.
2. **Prices are server-calculated.** The mockups compute BOGO, coupons and delivery in the browser for demo purposes only. Use `POST /pricing/quote` and `POST /delivery/quotes`.
3. **Detail views are side drawers.** Every admin detail (order, customer, product) opens a 480px right drawer that is full-screen below 480px, slides in over 280ms and is URL-addressable.
4. **Contrast fix.** #FFE0EC text on pink (4.0:1) appears in a few places in the canvas. Use white instead.
5. **No desktop storefront layouts exist.** Recommended ≥ 1024 behaviour is in 01-foundations.md › Responsive; confirm it with design before building it.
6. **Later-phase features** shown in the canvas are marked in each spec: wig quiz, 360° viewer, install bundle, live map, edit-order window, checkout rating, express/saved-card checkout, campaign calendar, Q&A, custom review replies.
7. **Placeholder content.** All names, numbers, reviews, phone numbers and prices in the canvas are sample data. Bracketed values ([YOUR NUMBER], [yourdomain], [Showroom address], VAT rate) need real values from the business.
8. **Where the admin lives**: this frontend app is the storefront today. The specs assume an `/admin` route group in the same Next.js app with its own layout and auth guard. If you'd rather have a separate `admin` workspace, the specs still apply unchanged.

## About the reference files
`reference/*.dc.html` are the canvas's own source files. They depend on the canvas runtime (`support.js`) and **won't run standalone**. Read them for exact copy, sizes, colours and the interaction logic in each file's `<script>` (`renderVals()`), but don't copy the markup, which uses inline styles and template syntax. Build with the tokens and components instead.
