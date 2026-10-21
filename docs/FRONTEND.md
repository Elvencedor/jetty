# Jetty's Hair — Frontend implementation plan

**Status:** Proposed plan  
**Scope:** the Next.js app in [`frontend/`](../frontend): customer storefront and the `/admin` portal  
**Inputs:** [Feature inventory](./FEATURES.md) · [API contract and what is implemented](./API.md) · [Design handoff](../frontend/design/README.md) (15 screen specs, tokens, components) · the Next.js 16.4 docs bundled in `node_modules/next/dist/docs`

Estimates are ideal developer-days for one experienced developer, rough (±30%). They exclude waiting on design or business input.

---

## 1. The short version

1. **Build in purchase order, not screen order.** Catalog read path → bag and checkout → accounts → content and SEO. A shopper can buy after phase 2; everything else improves on that.
2. **One Next.js app, two route groups.** `(store)` for customers and `admin` for staff, as the design handoff assumes. Admin code is split away from the storefront bundle.
3. **The browser talks to the API directly** (`api.<domain>`, same site as the frontend). The API's cookies, CORS credentials and exposed headers were built for this. A Next.js rewrite proxy is the fallback, not the default (see §3.2).
4. **The client owns the cart; the server prices everything.** Local storage holds variant ids, quantities and codes only. Every total comes from `POST /pricing/quote`.
5. **The design and the built API disagreed in places.** §5 lists 14 API changes (A1–A14). **A1–A5 and A7–A10 are now built and tested** (see [API.md](./API.md#contract-additions-for-the-frontend-implemented)); A6 and A11–A14 remain, each with a fallback, so nothing blocks launch.
6. **The storefront editor is cut down for launch.** The designed WYSIWYG editor with drafts, undo and history needs an API that does not exist. P0 ships list-and-form management of announcements, hero cards, the featured row and pages.
7. **Deliberate deviations from the design handoff** (no card fields, no 2FA screen, no team screen, no USSD or pay-on-delivery) are in §8.
8. **Total: about 75 dev-days** (about 15 weeks for one developer, 8–9 weeks for two working storefront and admin in parallel after phase 0).

---

## 2. Where we are starting

### Frontend today
A scaffold: one placeholder page, Geist fonts, a typed `apiFetch`/`ApiError`/`formatNaira` in [`src/lib/api.ts`](../frontend/src/lib/api.ts), and `cacheComponents` plus `partialPrefetching` already on in [`next.config.ts`](../frontend/next.config.ts). No UI library, no state, no tests. The design tokens ([`design/tokens.css`](../frontend/design/tokens.css)) are written but not wired in, and `lucide-react` is not installed.

### API today (all P0 endpoints built)
Catalog, quotes, checkout (card and bank transfer), Paystack verify/webhook, customer auth (password, OTP, reset), order history and guest tracking, reviews, home content, static pages, public settings, event ingestion, and the full admin API including refunds. **Not built (P1/P2):** wishlist, addresses, saved cards, returns, back-in-stock, rider assignment, USSD and pay-on-delivery, available-offers list, team and audit log, admin 2FA, CSV export.

### `Next.js 16.4` notes that shape the plan
The repo's `frontend/AGENTS.md` says this version differs from older Next.js. From the bundled docs:
- With `cacheComponents`, anything that reads the request (cookies, headers, `searchParams`) must sit under `<Suspense>`; static and `'use cache'` content forms the prerendered shell. Cache with `'use cache'` + `cacheLife` + `cacheTag`.
- Middleware is now `proxy.ts`. It is only for optimistic redirects, never real authorization.
- Routes can set `export const instant` for instant-navigation validation; opt out per route while migrating.
- **Before building each area, read the matching guide** (caching, forms, content-security-policy, authentication-with-cache-components, instant-navigation). Treat anything in this plan that depends on a Next.js behaviour as "verify against the bundled docs".

---

## 3. Architecture

### 3.1 Stack and dependencies
Keep the dependency list short; each item earns its place.

| Dependency | Why | Loaded where |
|---|---|---|
| `lucide-react` | Icon set the design specifies | everywhere (tree-shaken) |
| `zustand` | All client state: cart, wishlist, checkout draft, session tokens, analytics identity. `persist` middleware replaces hand-written `localStorage` code | client components |
| `@tanstack/react-query` | **Server** state only: quotes, account, reviews paging, and all admin tables, mutations, optimistic edits, invalidation | client components; admin heavily |
| `zod` | Client-side validation (phone, address, admin forms) and parsing of API payloads at the boundary | forms |
| `react-hook-form` + `@hookform/resolvers` | Large admin forms only (product, promotion, settings). Storefront forms use native inputs + zod to keep JS small | admin |
| `@paystack/inline-js` | Open Paystack's popup from the `accessCode` returned by `POST /checkout` | checkout only (dynamic import) |
| `@dnd-kit/core` + `sortable` | Reorder media, hero cards, featured products; keyboard-accessible | admin only |
| `react-markdown` + `rehype-sanitize` | Render static pages and product details safely | server |
| `@sentry/nextjs` (or equivalent) | QA-05 error tracking | both |
| Dev: `vitest`, `@testing-library/react`, `msw`, `@playwright/test`, `@axe-core/playwright` | Unit, component, mocked-API and end-to-end tests | dev |

Not adding: a component kit (the design has its own), a charting library (the dashboard needs one line chart and a few bars; hand-written SVG keeps admin light), a date library (native inputs; format with `Intl` in `Africa/Lagos`).

### 3.2 How the browser reaches the API
**Default: direct calls to `api.<domain>`.** Frontend and API share a registrable domain (confirmed), so the API's `SameSite` cookies work and its CORS setup (credentials, `If-Match`, `Idempotency-Key`, `ETag`, `Retry-After` exposed) already supports it. Set `NEXT_PUBLIC_API_BASE_URL=https://api.<domain>/api/v1` and add the storefront origin to the API's `CORS_ORIGINS`.

**Fallback: a Next.js `rewrites()` proxy** (`/api/v1/*` → API) if a real device shows cookie trouble (older Safari, in-app browsers). It makes cookies first-party but adds a hop, and then **`TRUSTED_PROXY_HOPS` must count the Next.js server**, otherwise every shopper shares one IP in the rate limiter. Don't switch without testing that.

Local development: Chrome and Firefox accept `Secure` cookies on `http://localhost`; Safari does not, so use `next dev --experimental-https` there.

### 3.3 Rendering and caching
| Surface | Strategy |
|---|---|
| Home, shop, product, static pages | Server components. Data functions use `'use cache'` with `cacheLife` of 30–60s (matching the API's `Cache-Control`) and tags (`home`, `catalog`, `product:{slug}`). Personalised or live parts (bag count, price quote, stock) are client components inside `<Suspense>` |
| Search and filtered listings | Server-rendered from URL params so filters are shareable (`?texture=…&sort=…&view=list`); "Show more" appends client-side with the cursor |
| Bag, checkout, order pages, account | Client-rendered behind Suspense. Never cached |
| Admin | Static shell, everything fetched client-side with TanStack Query and a bearer token |

Admin publishes a product and the storefront catches up within the cache window (≤60s). If that is too slow, add a secured `/api/revalidate` route that the API calls after admin mutations (small, optional, listed in §5 as A14).

### 3.4 Authentication in the browser
Both refresh cookies are `HttpOnly` with narrow paths (`/api/v1/auth`, `/api/v1/admin/auth`), so **Next.js server code and `proxy.ts` can never see them**. Consequences:
- Two Zustand session stores (customer and admin) keep the 15-minute access token **in memory only** (never persisted). A bootstrap component calls `POST /auth/refresh` on first load and again before expiry, and the API client retries a request once on `401`. The API client reads the token straight from the store, so no React context is involved.
- Account pages and the whole admin render client-side after the session resolves. `proxy.ts` is not used for auth. Admin routes get `noindex`.
- Two independent providers: customer and admin. Their tokens are not interchangeable.
- `apiFetch` is extended to: add the bearer, send `credentials: 'include'`, refresh-and-retry, handle `204`, expose `ETag`, and surface `Retry-After` on `429`.

### 3.5 Cart and quote
- `useCartStore` (Zustand `persist`, key `jh.cart.v1`, re-hydrated on the `storage` event for cross-tab sync, versioned for migrations) holds `{ variantId, quantity }[]` and `promotionCodes[]` and nothing else. Selectors report an empty cart until the store has hydrated, so the header badge causes no hydration mismatch.
- `useQuote()` calls `POST /pricing/quote` (debounced 300ms, `keepPreviousData`, re-quote on tab focus and when `quoteExpiresAt` passes). The bag, checkout and PDP price all read it.
- Quote lines carry everything a bag line displays (title, slug, image, options, was-price, available stock; API change **A1**, done), so the cart needs no product lookups and no local snapshot. There is no `priceChanged` flag (the API refuses client prices); to show "Price updated from ₦X", keep the unit price you last displayed and compare.

### 3.6 Checkout and payments
- A Zustand checkout store (`persist` to `sessionStorage`) holds the form step, contact, address and the idempotency key; contact and address are never put in the cart store.
- Phone: accept `0803…`, `+234…`, `234…`; normalise to E.164 before sending.
- `Idempotency-Key = crypto.randomUUID()` (the API requires 32+ characters for guests), generated when the shopper reaches Review and reused for every retry of the same submission; discarded on success or a definitive failure.
- `POST /checkout` → open Paystack with `accessCode` (card or bank-transfer channel) → on success/close go to `/checkout/return?reference=` → `POST /checkout/paystack/verify` → poll `GET /checkout/{orderId}/status` every 2s for 60s → `/order/{orderNumber}/confirmed`. A mobile in-app browser may redirect instead of popping up, so `/checkout/return` must work on its own from `?reference=` alone.
- The guest cookie `jh_checkout` (set by the API, path `/api/v1/checkout`) authorises status polling and payment retries. If it is missing, fall back to the `/track` lookup.
- Failure states exactly as the design table: pending transfer, declined, popup closed, total changed (server returns a new total and asks for one more confirm), reservation expired.

### 3.7 Images
**Decided: a CDN in front of the bucket.** The API returns a stable public `url` per image when `MEDIA_PUBLIC_BASE_URL` is set (and hourly-stable presigned URLs otherwise, for local development).
- Allow the CDN host in `images.remotePatterns` and use `next/image` with explicit `width`/`height` (the API returns them when staff supplied them), `fetchPriority="high"` on the LCP image, lazy loading elsewhere. Because URLs are stable, Next's optimiser cache works.
- The admin uploader still resizes before upload (canvas → one WebP, max 1200px wide): the API keeps a single key per image and does no processing.
- Everything goes through one `Media` component, so swapping to a CDN image loader later is a one-file change.

### 3.8 Analytics, SEO, accessibility, performance
- **Events:** a tiny client (identity kept in a persisted Zustand store) that batches `session_start`, `product_view`, `add_to_bag`, `checkout_start` to `POST /analytics/events` (anonymous id, and a session id that rolls over after 30 minutes idle, `sendBeacon` on page hide). No `purchase` event (the server counts paid orders).
- **SEO:** per-route `generateMetadata`, Open Graph, `Product` JSON-LD with price and availability, `sitemap.ts` (paginating `GET /products`) and `robots.ts` (disallow `/admin`, `/bag`, `/checkout`, `/account`).
- **Accessibility:** WCAG 2.1 AA from the design foundations (focus ring, `role="status"`/`alert` regions, dialog focus trap, 44px targets, reduced motion). `axe` runs in the Playwright flows.
- **Performance budgets (QA-01):** LCP < 2.5s and CLS < 0.1 on a throttled mid-range Android profile; initial JS for storefront routes ≤ 170 KB gzipped; admin and Paystack code only loaded on their routes.
- **Security:** CSP with nonces per the bundled `content-security-policy` guide (allow `js.paystack.co` and the image host), sanitised markdown, validated `ctaUrl`/redirect targets, no secrets in `NEXT_PUBLIC_*`.

### 3.9 Folder structure
```
frontend/src/
  app/
    (store)/                 layout: header, tab bar, footer, announcement bar
      page.tsx               home
      shop/[[...collection]] listing    search/        p/[slug]/
      bag/   checkout/ (+return)   order/[orderNumber]/confirmed   track/
      saved/   account/ (sign-in, orders, orders/[id], reset)   pages/[slug]/
    admin/                   layout: AdminGate, top nav (noindex)
      login/  (overview)  orders/  products/  customers/  promotions/  storefront/  reviews/  settings/[section]/
    sitemap.ts  robots.ts  not-found.tsx  error.tsx
  components/ui/             Button, IconButton, Chip, Segmented, Switch, Input, Badge, StatusPill, SideDrawer, BottomSheet, EmptyState …
  components/commerce/       ProductCard, PriceSummary, DealTracker, CouponTicket, StepIndicator, OrderTracker, FilterSheet, Countdown, Media
  components/admin/          AdminTopNav, DataTable, Kpi, charts, FormSection, InlineEditor …
  lib/api/                   client.ts, types.ts, and one module per domain (catalog, quote, checkout, auth, orders, reviews, admin/*)
  lib/                       cart/, session/, analytics/, format.ts (money, Lagos dates, phone), hooks/
```

---

## 4. Route map

| Route | Purpose | Features | Phase | API |
|---|---|---|---|---|
| `/` | Home | DISC-01, 11, 12; CMS-01–03 | 1 | `GET /storefront/home`, `/categories`, `/storefront/settings` |
| `/shop`, `/shop/[collection]` | Listing | DISC-02–10, 12; CMS-07 | 1 | `GET /collections/{slug}/products`, `GET /products` |
| `/search?q=` | Search results | DISC-04 | 1 | `GET /products?q=`, `/products/suggestions` |
| `/p/[slug]` | Product detail | PDP-01–13, 16; REV-01, 02 | 1 | `GET /products/{slug}`, reviews, `POST /pricing/quote`, `POST /delivery/quotes` |
| `/saved` | Local wishlist | WISH-01/02 (local only) | 1 | `GET /products/{slug}` |
| `/bag` | Bag | CART-01–07, 09; PROMO display | 2 | `POST /pricing/quote` |
| `/checkout` (`?step=`) | 3-step checkout | CHK-01–06, 10–13; ACC-01 | 2 | `POST /delivery/quotes`, `/checkout`, … |
| `/checkout/return` | Paystack return + polling | CHK-10 | 2 | `POST /checkout/paystack/verify`, `GET /checkout/{id}/status` |
| `/order/[orderNumber]/confirmed` | Confirmation | ORD-01, 04 | 2 | status, snapshot in sessionStorage |
| `/track` | Guest tracking | ORD-05 | 2 | `POST /orders/track` |
| `/account/sign-in`, `/account/reset` | Password, OTP, reset | ACC-02, 04 | 3 | `/auth/*` |
| `/account`, `/account/orders`, `/account/orders/[id]` | Me, history, detail, review | ACC-07; REV-01 | 3 | `/me`, `/me/orders`, `POST /reviews` |
| `/pages/[slug]` | Returns, FAQ, size/care guide, terms, privacy, contact | CMS-09; PDP-12 | 4 | `GET /content/pages/{slug}` |
| `/admin/login` | Admin sign-in | ADM-01 | 5 | `/admin/auth/*` |
| `/admin` | Overview | ANL-01–03, 05, 09 | 6 | `/admin/dashboard`, `/admin/analytics/*`, `/admin/orders-to-action` |
| `/admin/orders` (`?order=`) | Orders + drawer | OPS-01–04, 06, 07 | 6 | `/admin/orders*`, refunds, notes |
| `/admin/products` (`?product=&tab=`) | Catalog, variants, media, stock | CAT-01–06, 08, 09 | 6 | `/admin/products*`, `/admin/inventory`, media |
| `/admin/customers` | Customers (list + light profile) | CUS-01 | 6 | `/admin/customers*` |
| `/admin/promotions`, `/new`, `/[id]` | Promotion builder | PROMO-01–11; PADM-01–03 | 6 | `/admin/promotions*` |
| `/admin/storefront` | Content manager (reduced) | CMS-01–03, 09 | 6 | `/admin/content*` |
| `/admin/reviews` | Moderation | MOD-01 | 6 | `/admin/reviews*` |
| `/admin/settings/[section]` | Store, delivery, payments, policies | SET-01–03, 05 | 6 | `/admin/settings/{key}` |

---

## 5. API changes the frontend needs

✅ = implemented and tested. The rest are still to do. "Fallback" is what the frontend does if the change slips; the screen still works, just less polished.

| # | Change | Why (design/spec reference) | Needed by | Fallback | Size |
|---|---|---|---|---|---|
| **A1** ✅ | Enrich `POST /pricing/quote` lines with `productId`, `slug`, `title`, `image`, `optionSummary`, `compareAtPriceMinor`, `availableQuantity`; add `priceChanged` | Bag/checkout lines need names and photos; "Price updated from ₦X" (04-bag) | Phase 2 | Local display snapshot per line + fetch `GET /products/{slug}` | S |
| **A2** ✅ | Order detail: add `id`, `slug` and image per item; `reviewable` flag; `ETA`/`deliveryEstimate`; first name | Reviews need `orderItemId` (today missing); confirmation hero, thumbnails | Phase 3 | Reviews unavailable until done; skip thumbnails | S |
| **A3** ✅ | Listing: add `total` count, facet endpoint (`GET /products/facets`: option values + counts for the current filters), and card `colours[]`, `lengthRange`, computed `badges[]` (sale %, BOGO, new, low stock) | FilterSheet "Show N wigs", colour dots, length meta, badges (02-shop, ProductCard) | Phase 1 | Static filter lists from config; no live count; cards without dots | M |
| **A4** ✅ | Product detail: option value `swatch` hex, `defaultVariantId` (best seller), `soldCount`; define and validate the `details` shape `{ details, fit, care, delivery }` (markdown) | Swatches, default selection, info tabs (03-product) | Phase 1 | Cheapest variant default; colour chips as text; tabs from free-form `details` | S |
| **A5** ✅ | Home sections model: ordered `sections[]` with `type` (hero, picks, tiles, length, trust, stories, flash …), hero fields `tag`, `tone`, plus `flash` summary (promotion `code`, `endsAt`, headline) | The design renders home from a list (01-home) | Phase 1 (core), 6 (admin) | Fixed section order from the three existing content types; no flash strip, stories or tiles | M |
| **A6** | Quote `promotions[].progress` / free-delivery threshold; later `GET /promotions/available` (P1) | DealTracker and CouponTicket (04-bag) | Phase 2 (nice) | Show applied discounts and rejected-code reasons only; code entry box only | M |
| **A7** ✅ | Raise the variant matrix limit from 300 to 2000 and keep the response paginated or lean | Design expects 1,000+ variants per wig (02-products) | Phase 6 | Warn above 300 variants per product | S |
| **A8** ✅ | Admin orders: first-item thumbnail and item count in the list; `POST /admin/orders/{id}/cancel`; delivery/rider `PATCH` (P1) | Orders table and drawer (04-orders) | Phase 6 | Plain table without thumbnails; no cancel/rider | M |
| **A9** ✅ | Admin customers: segment counts (`GET /admin/customers/segments`) and `segment` filter | Segment tiles (05-customers) | Phase 6 | Hide tiles; search + sort only | S |
| **A10** ✅ | `/checkout/{id}/status`: include `deliveryMethod`, estimate and item count | Confirmation after reload; guests have no richer endpoint | Phase 2 | Use the sessionStorage snapshot; after reload show status + tracking only | S |
| **A11** | Back-in-stock subscription (`POST /products/{id}/stock-notifications`) | "Notify me" on sold-out options (PDP-06 P1) | P1 | Disabled chips only | M |
| **A12** | Guest order claim after sign-up (ACC-03) | Confirmation "Save your details" card | P1 | Hide the card | M |
| **A13** | CMS: draft vs published versions, sections with ordering, preview, history | Full storefront editor (06-storefront-editor) | P1 | Reduced editor (§6 phase 6, item 8) | L |
| **A15** ✅ | Optional customer auth on `POST /pricing/quote` and `/delivery/quotes` | Bag and checkout totals must agree for signed-in customers | Phase 0 | Account-only offers missing from the bag | S |
| **A14** | Optional: API calls a secured `/api/revalidate` on the frontend after admin mutations | Instant storefront updates | optional | ≤60s staleness | S |

---

## 6. Phased plan

### Phase 0 — Foundations (4 days)
**Goal:** every later screen builds on the same tokens, primitives, API client and tests.
- Wire `design/tokens.css` into `globals.css`; load Bricolage Grotesque and Figtree (replacing Geist); remove the dark-mode override (light-only); global `prefers-reduced-motion`, focus ring, `scroll-padding-bottom`, `dvh`-safe layouts.
- Allow the CDN host in `images.remotePatterns`. Install the dependencies in §3.1. Add a skip link and root `error.tsx`/`not-found.tsx`.
- Rework [`lib/api.ts`](../frontend/src/lib/api.ts) into `lib/api/`: bearer + refresh-retry, `credentials: 'include'`, `204`, `ETag`, `Retry-After`; typed modules per domain mirroring [docs/API.md](./API.md); `format.ts` (`formatNaira`, compact Naira for dashboards, Lagos dates, relative times, phone normalisation with unit tests).
- `QueryProvider`, Zustand stores (customer and admin session, cart, analytics identity; wishlist and checkout draft follow the same helper in their phases), session bootstrap, analytics client, error reporting hook.
- Primitives needed first: Button, IconButton, Input/Select/Textarea, Chip, Segmented/PillTabs, Switch, Badge, StatusPill, Skeleton, EmptyState, `Media`.
- Tooling: Vitest + Testing Library + MSW, Playwright config, ESLint rules matching the API's strictness, CI steps (typecheck, lint, unit, build; e2e on the main branch). Sentry wiring behind an env flag.
- **Done when:** a styled placeholder page renders with the real tokens and fonts, `npm run check` passes in CI, and an MSW-backed test of `apiFetch` covers refresh-retry and error mapping.

**Status: done.** All of the above shipped, with these differences from the plan:
- **Deferred to the phase that first needs them** (installing them now would only add noise): `react-hook-form` and `@hookform/resolvers` (admin forms, phase 5; the resolvers' latest version has an unresolved optional-peer conflict, so pick a compatible one then), `@paystack/inline-js` (phase 2), `@dnd-kit` (phase 6), `react-markdown` + `rehype-sanitize` (phase 1 for product tabs). Sentry is behind `setErrorReporter` in `lib/monitoring.ts`; the real SDK is wired in phase 7 when there is a DSN.
- **Zustand, not React context,** holds all client state (decision made during this phase): cart, customer and admin sessions, analytics identity, session hints. Persisted stores hydrate after mount.
- **A first-time visitor makes no refresh request.** A persisted hint (`jh.session-hints.v1`) records whether this browser has been signed in, so only returning customers call `POST /auth/refresh`.
- **One API change came out of it:** `POST /pricing/quote` and `POST /delivery/quotes` now accept the customer's bearer token (optional), so account-only offers (first order, per-customer limits) show in the bag exactly as checkout will apply them. Without it the bag and checkout totals disagreed for signed-in customers.
- **Found and fixed on the way:** Tailwind 4 has no `duration-*` theme namespace (the design's motion tokens are written `duration-(--duration-fast)`); a cross-realm `AbortError` check; two accessibility mismatches caught by axe in the primitives gallery; MSW 3 renamed `onUnhandledRequest` to `onUnhandledFrame`.
- **Extras:** `/dev/ui` primitives gallery (404 in production), `lib/status.ts` (status → label/colour, tracker progress), a Playwright smoke suite on phone and desktop profiles, and a CI job that runs it on `main`.

Checks at the end of the phase: 116 unit/component tests, typecheck, lint and production build clean; 7 browser tests pass (brand pink and both fonts in a real browser, axe-clean home, skip link, branded 404, gallery hidden in production); the gallery is axe-clean at 390px.

### Phase 1 — Catalog read path (9 days)
**Goal:** a shopper can browse, search, filter and pick a variant on a phone. *A3–A5 are built, so the facet counts, colour dots, badges, default variant and home sections come straight from the API.*
1. **Shell (1d):** `(store)` layout, header (logo, search, bag icon with count), `BottomTabBar` (<1024px) / top header (≥1024), footer from `GET /storefront/settings`, `AnnouncementBar` (rotating, from `/storefront/home`).
2. **Home (2d):** render sections from the list; hero carousel (scroll-snap), picks with tabs, category tiles from `/categories`, length bars linking to `/shop?length=`, trust block, static footer content. Stories, flash strip, UGC, quiz hidden until A5 exists.
3. **ProductCard + listing (3d):** the `grid`, `pick` and `list` layouts; `/shop/[[...collection]]` and `/search` share one page; URL-driven filters/sort/view (view remembered in localStorage); results meta; "Show more" with focus on the first new card; empty/error states; FilterSheet (bottom sheet <768, right drawer ≥768) with chips, swatches, price range with number-input fallback, toggles; search with type-ahead (debounced 200ms, `/products/suggestions`).
4. **Product detail (3d):** gallery with angle chips, keyboard/swipe, full-screen zoom; the "Build your wig" accordion (one step open, auto-advance, summary card); variant resolution from `variants[].optionValueIds` and availability (disabled/struck-through unavailable combinations); price via `POST /pricing/quote`; info tabs (markdown, sanitised); reviews summary, breakdown, rating filter and "see all"; delivery estimate with a state picker; sticky bar (quantity + Add to bag → CartStore + inline status row); local wishlist heart; Share via the Web Share API.
- **Done when:** home, listing, search and PDP pass Lighthouse mobile budgets, filters survive reload and back/forward, and an e2e test adds a variant to the bag.

**Status: built; Lighthouse budgets are measured in phase 4's performance pass.** Differences from the plan:
- **`/shop/[[...slug]]` resolves the slug against `GET /categories`** and lists it as a category (`?category=`) or a collection (`/collections/{slug}/products`); an unknown slug is a not-found page.
- **Pages call `await connection()` before `'use cache'` reads** (`lib/catalog/data.ts`, 1–60 minute lifetimes, tagged for later revalidation), so a build never needs the API and the shell survives an API outage (footer and announcements fall back to nothing).
- **A missing product still answers 200.** The page streams, so the status is sent before the lookup finishes; Next adds `noindex` to the not-found content. Moving the check before the first byte would make the whole page uncacheable, so this is accepted.
- **Native `<dialog>`** powers the filter sheet/drawer and the photo zoom; no dialog library.
- **Stories, flash strip and the home "picks" tabs are built** (A5 landed); quiz and UGC sections are skipped when the API sends them.
- **Wishlist is a persisted zustand store of slugs** (`/saved` reads each product fresh); list/grid choice is remembered in `ui-prefs`.
- **Late-loading stores:** a persisted store whose module loads after the app-wide hydration pass (code-split behind a streamed section) now hydrates the moment it registers. Found by the browser tests: hearts did nothing on streamed pages.
- **Browser tests run against a fixture API** (`e2e/mock-api.mjs`), so they need no database; 21 pass on phone and desktop profiles, axe-clean on home, listing and product pages.


### Design conformance pass (after phases 1–3)

Phases 1–3 were first built from the markdown specs alone and drifted from the design. This pass re-did the layouts against
the specs **and the reference mockups in `frontend/design/reference/`** (exact copy, measurements and states), then checked
the result in a real browser at 390px.

**Now matches the design:** floating ink tab bar with five items (pink pill for the current one; hidden where a page has its
own bottom bar); per-page phone headers (home: wordmark, bag, search with filters button; shop: pink header block with
breadcrumb, view toggle and scoped search; product: full-bleed gallery with floating back/share/save, angle chips, content
sheet overlapping it; bag; checkout; confirmation hero); ink footer card; hero cards with the photo cut-out and the white/ink
tag pills; stories; flash strip; picks (framed cards with reviews and "+"); length bars; bento tiles; trust card; product card
in grid, pick and list forms with the struck "was" price; shop filter pills that open the sheet at their group, results meta,
"Show more (N)" and "That's everything", the empty state with best sellers; filter sheet with labelled 40px colour swatches, a
two-thumb price slider with number fields, and a debounced "Show N wigs" with spinner; the "Build your wig" accordion (58px
rows, numbered badges, chosen value in pink, sold-out chips disabled and announced, "+₦25k"/"Included" notes, 250ms
auto-advance, help links); "YOUR WIG" summary card; badges row; rating pill with "sold"; dashed delivery card with Change;
horizontal review cards and "See all"; sticky add-to-bag bar (6s "Added to bag", quantity capped at 5); bag on the tint
background with the floating total pill; 2×2 payment tiles, "Quick check" review step and terms as plain text; confirmation
hero, tracker with icons, courier card, WhatsApp help.

**Deliberately not built, and why:**
| Design element | Reason |
|---|---|
| Deal tracker, offer tickets (bag) | Need `GET /promotions/available` and quote `progress` (A6) |
| In-feed promo card (shop) | No CMS data for it yet (CMS-05) |
| Notifications bell (home header) | No notifications feature exists |
| Quiz, UGC strip, install bundle, 360° | P2 in the design |
| Review attribute chips and photo strip | The API has no such data |
| "Notify me" on sold-out options | Needs A11 |
| Rider map, "Edit order", "How was checkout?", install-day cards, "Save your details" | P2 or A12 |
| Saved card / Bank app express buttons, USSD, pay on delivery | P1 |
| "Get it today by 8pm… order within 3h 20m" | The delivery quote has dates, not cut-off times; the card shows the date |
| Desktop (≥1024) layouts | Not designed; the recommended top header and multi-column layouts are used |

**Small deviations kept:** the shop's Best selling sort (the API supports it); the promo-code box is titled "Promo code"
because there are no tickets above it; the review breakdown bars stay (we have that data); checkout asks for city and an
optional rider note (the API needs the city).

**API change that came with it:** `price.compareAtMinor` on listing cards (see `docs/API.md`).

### Phase 2 — Bag, checkout, confirmation (9 days)
**Goal:** a guest can pay by card or bank transfer and see their order. *Depends on A1; A6 and A10 optional.*
1. **CartStore + `useQuote` (1d)** with tests (merge duplicates, cross-tab sync, stale-quote refresh).
2. **Bag (2d):** line cards with stepper (optimistic, 300ms debounce, revert on stock error), remove with 5s undo, price-changed and unavailable states, code entry with the API's rejection reasons mapped to messages (`INVALID_CODE`, `EXPIRED`, `USAGE_LIMIT_REACHED`, `NOT_ELIGIBLE` → "Sign in to use this offer", `MIN_SPEND_NOT_MET`, `NOT_APPLICABLE`), `PriceSummary` with savings banner, free-delivery progress (A6), empty state, sticky checkout pill.
3. **Checkout (3d):** Step 1 Delivery (zod validation on blur, E.164 phone, Nigerian state list, delivery options from `POST /delivery/quotes`, cut-off and unavailable messaging); Step 2 Payment (Card and Bank transfer only; honour `payments.enabledMethods` from public settings); Step 3 Review (edit jumps, terms link, method-specific final label); `StepIndicator`; sticky action bar; sessionStorage persistence; `Idempotency-Key` handling.
4. **Payment flow (2d):** Paystack popup with `accessCode`, `/checkout/return` verify + 2s polling, every state in the design table (declined, closed, pending transfer, total changed, reservation expired, 409 `OUT_OF_STOCK`/`PROMOTION_UNAVAILABLE` with a refreshed bag), retry via `POST /checkout/{id}/payment-attempts`.
5. **Confirmation + tracking (1d):** `OrderTracker`, status-driven hero, pending-transfer and cancelled/refunded variants, 30s polling while non-final; `/track` form (order number + phone, 404 handled as "not found"); copy on pickup orders.
- **Done when:** the Playwright purchase flow (browse → bag → code → checkout → mocked Paystack success → confirmation) passes, plus failure and reservation-expiry paths; a real Paystack test-mode payment succeeds on a phone.

**Status: built, except what needs a real Paystack account.** Differences from the plan:
- **Confirmation lives at `/order/[orderId]/confirmed`** (the status endpoint is keyed by order id, and a guest's cookie is bound to it), and payment at `/checkout/pay?order=` with `/checkout/return?reference=` for redirect-style returns.
- **Validation is hand-written** (`lib/checkout/validation.ts`, mirrors the API's Joi rules, 13 tests) rather than zod: the rules are a dozen lines and it keeps a schema library out of the bundle.
- **The Paystack window is exercised only by the library itself.** The browser tests cover everything around it (steps, submit, return-and-verify, failure and retry, confirmation) against the fixture API; opening the real popup needs a Paystack test key, so that last check is the one remaining item for "done when".
- **Safety nets:** an identical resubmit reuses its idempotency key (a changed request gets a new one); the order id, reference and access code are kept in sessionStorage so a reload resumes the same payment; if the server's total differs from the one reviewed, the shopper must confirm the new amount before the window opens; the bag is emptied only when the server says paid.
- **Left out because the API does not provide it yet:** the DealTracker and coupon tickets (A6), "price changed since added" on bag lines (the quote carries no earlier price), USSD and pay-on-delivery (P1).
- Bottom tab bar is hidden during checkout (it shares the bottom edge with the step bar).


### Phase 3 — Accounts (4 days)
- Sign-in page: email and password, register, and password reset by an emailed code. Google sign-in is the planned alternative (`POST /auth/google`, P1). Handle `INVALID_CREDENTIALS`, `INVALID_CODE`, `429` with `Retry-After`.
- Me tab and `/account`: profile, sign out. Order history (cursor paging) and detail with the same `OrderTracker`; guests get a prompt to track.
- Review submission from a delivered order item (needs **A2**).
- Local wishlist merges on sign-in (server wishlist is P1).
- **Done when:** a customer can register, sign in by OTP, see an order they placed while signed in, and reset their password; session survives reload via refresh.

**Status: built.** Differences from the plan:
- **Routes:** `/account` (the Me tab: sign-in prompt for guests, details and sign-out for customers), `/account/sign-in` (email and password, or create an account; honours a validated `?next=`), `/account/reset-password`, `/account/orders` and `/account/orders/[orderId]`.
- **Return links are validated** (`safeNext`): only paths on this site are followed, so `?next=//evil.example` falls back to `/account`.
- **Account data is forgotten when the signed-in person changes or signs out**, so a shared device never shows the previous customer's orders, even from cache.
- **Checkout** prefills a signed-in customer's phone and email (never over what was typed) and offers a sign-in link; guests are unaffected.
- **Reviews** are written from a delivered order's items (`reviewable`), and the form says new reviews wait for a moderator.
- **Wishlist merge on sign-in is a no-op for now:** the wishlist stays on the device until the server wishlist (P1) exists.
- **Email and password only (changed after this phase first shipped).** Phone sign-in codes were removed from the API and the screens; customers register and sign in with an email, and the phone number is asked for at checkout, where delivery needs it. Password reset is an emailed code. Google sign-in is the planned alternative: the sign-in screen leaves room for a "Continue with Google" button, and the API side (`POST /auth/google`, linking by verified email only) is listed as P1 in `docs/API.md`.


### Phase 4 — Content, trust, SEO, analytics (4 days)
- `/pages/[slug]` for returns, FAQs, size guide, care guide, terms, privacy, contact (server-rendered, sanitised markdown); header/footer/PDP links to them; cap-size guide link on PDP.
- Cookie/privacy notice (inline, non-blocking) for NDPR; analytics events wired at product view, add to bag, checkout start.
- `sitemap.ts`, `robots.ts`, metadata and OG images, `Product` JSON-LD, canonical URLs for filtered pages.
- Performance pass: bundle analysis, image sizing, font subsetting, prefetch tuning with `partialPrefetching`, CLS check.
- **Done when:** Lighthouse mobile ≥ 90 performance/accessibility/SEO on home, listing and PDP; sitemap lists every active product.

### Phase 5 — Admin foundation (4 days) — can start in parallel with phase 1
- `admin` route group, `AdminSessionProvider` (refresh-on-load, login redirect), login screen (email + password; **no 2FA step**), `AdminTopNav` that hides items by `permissions` from `GET /admin/me`, count badges (orders to action from `/admin/orders-to-action`, pending reviews), page header pattern.
- `DataTable` (cursor paging, selection), `SideDrawer` (URL-addressable via search params, focus trap, dirty-form guard, 100dvh), `FormSection`/`InlineEditor`, `Toast`, `ConfirmDialog`, `useUrlState`, query-key conventions, `ETag`/`If-Match` helper with the 412 "someone else changed this" flow, Lagos time formatting.
- **Done when:** a seeded owner signs in, sees the nav, a role with fewer permissions sees fewer items, and a 401 returns to login.

### Phase 6 — Admin screens (35 days). Order by launch value
| # | Screen | Days | Notes |
|---|---|---|---|
| 1 | **Products & variants** | 9 | The riskiest screen. List cards + drawer tabs Basics / Variants / Media / Merchandising. The matrix builder generates the full variant set client-side (base price + value deltas → explicit `priceMinor` per variant) and saves with `PUT …/variants` (needs `If-Match`; up to 2,000 variants, built). Impact notes ("creates N variants"), hide-instead-of-delete, grouped variant list with filters and bulk set price / add stock (writes inventory movements), per-variant stock editor with low-stock threshold, upload via upload-intents with client-side WebP resize, progress and reorder (dnd-kit), publish/archive. SEO fields collapsed |
| 2 | **Orders** | 5 | List with status pills, search, date filter; drawer with the single "next step" button per status (confirm transfer with reference/reason, mark packed, hand to rider → shown without rider until P1, mark delivered), items, customer, activity, internal notes, **refund dialog** (full/partial/duplicate with `paymentAttemptId` picker and `Idempotency-Key`), packing-slip print view; cancel (`/cancel`) and rider assignment (`/delivery`) are available now |
| 3 | **Dashboard** | 4 | Range picker in URL; revenue line (current vs previous) as accessible SVG with table toggle; KPI tiles with deltas; orders-to-action tiles linking to filtered orders; best sellers; category bars; card-level skeleton/error. Funnel, live campaigns and new-vs-returning are P1 (API) |
| 4 | **Promotions** | 5 | List with derived status; the builder as a 4-step wizard (Type → Rule as a plain-English sentence → Who & limits → Schedule), validations from the design (percent 1–90, code 4–20 chars), live plain-English summary (PADM-03); activate/deactivate; edit-while-live warning. Gift type, placements, calendar and live phone preview are P1/P2 |
| 5 | **Reviews** | 2 | Queue tabs, approve/hide with 5s undo, J/K/A/H shortcuts. Flags, pinning and request settings are P1 |
| 6 | **Customers** | 2 | Search, sort by newest/spend, row drawer with stats and recent orders; segment tiles when **A9** exists. Consent, notes, disable and export are P1 |
| 7 | **Settings** | 4 | Store details, Delivery & pickup (zone cards, areas, fees, cut-off, active toggle with open-order warning), Payments (method switches, card/transfer hold minutes), Returns & policies, plus unsaved-changes guard |
| 8 | **Storefront content (reduced)** | 4 | Tabs: Announcements, Hero cards (with `ctaUrl` validation, schedule, ordering via dnd-kit), Featured products row (picker + ordering), Pages (markdown editor with preview). No drafts/undo/history until **A13** |
| — | Team & roles | 0 | Not in P0 (no API). Show the signed-in admin's role in the avatar menu |

### Phase 7 — Hardening and launch (6 days)
- Playwright suites: purchase (card success, transfer pending, declined, expired reservation), guest tracking, account OTP, admin order fulfilment and refund, admin product create → publish → appears on storefront.
- `axe` pass on every storefront route and each admin drawer; keyboard-only pass of checkout and the product editor.
- CSP in report-only, then enforced; dependency audit; Sentry release + source maps; Web Vitals reporting.
- Deployment config for the real hosts, environment matrix (dev/staging/prod), `NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGINS` on the API, domain layout.
- Content load: real copy for pages, WhatsApp number, showroom address, policy text.
- Launch checklist in §10.

### Parallelisation
```
Phase 0 ─┬─ Phase 1 ─ Phase 2 ─ Phase 3 ─ Phase 4 ─┐
         └─ Phase 5 ─ Phase 6 (products, orders first) ─┴─ Phase 7
API changes A1–A5 start with phase 0; A7–A10 land before phase 6.
```
With two developers, one takes phases 1–4 and the other 5–6 after phase 0; phase 7 is shared. Admin **Products** and **Orders** should land early so the owner can start entering the catalog while the storefront finishes.

---

## 7. Feature coverage

Everything in [FEATURES.md](./FEATURES.md) that touches the frontend, and where it lands. "P1/P2" items are deliberately not in this plan; the list is the backlog.

| Area | In this plan (phase) | Deferred |
|---|---|---|
| Platform | PLAT-03 mobile-first (all), PLAT-05 Naira (0), PLAT-06 env/config (7). PLAT-04 reduced to client-side resize + presigned URLs (6) | PLAT-02 second theme (P1), PLAT-08 flags (P2) |
| Accounts | ACC-01 guest checkout (2), ACC-02 sign-up/OTP (3), ACC-04 reset (3), ACC-07 history (3) | ACC-03 (A12), ACC-05 addresses, ACC-06 cards, ACC-09 prefs (P1); ACC-08, ACC-10 (P2) |
| Discovery | DISC-01–04, 06–08, 10–12 (1); DISC-09 grid/list (1) | DISC-05 synonyms (backend), DISC-13 quiz, DISC-14 recently viewed (P2) |
| Product page | PDP-01, 02, 04, 05, 07, 08, 09, 10, 11, 12, 13, 16 (local) (1); PDP-17 share (1) | PDP-03 360° (P2), PDP-06 notify (A11), PDP-14 add-ons (P1), PDP-15 bundle, PDP-18 (P2) |
| Reviews | REV-01, 02 (1, 3), rating filter (1) | REV-03, 04, 07 (P1), REV-05, 06, 08, 09 (P2) |
| Wishlist | Local only: WISH-01/02 (1, 3) | Server wishlist, alerts (P1/P2) |
| Bag | CART-01–04, 07, 09 (2); CART-06 per A6 | CART-05 offers list, CART-08 upsell, CART-10 abandoned recovery (P1) |
| Promotions | PROMO-01–03, 05–12 (storefront display 2, admin builder 6) | PROMO-04 gift, 13, 14 (P1/P2) |
| Checkout | CHK-01–06, 10–13 (2) | CHK-07 USSD, 08 pay on delivery, 09 express (P1), 14 (P2) |
| Orders | ORD-01, 04, 05 (2); ORD-02/03 backend notifications | ORD-06 rider, 08 returns, 09 content (P1), 07, 10 (P2) |
| Content (CMS) | CMS-01–03, 07, 09 (1, 4, 6) | CMS-04–06, 08, 10, 11 (P1; need A5/A13) |
| Admin access | ADM-01 sign-in (5, **no 2FA by decision**), ADM-02 permission mirroring (5) | ADM-03 team, ADM-04 audit log (P1) |
| Analytics | ANL-01–03, 05, 09 (6) | ANL-04, 06–08 (P1; API), ANL-10 (P2), ANL-11 CSV (P1) |
| Orders admin | OPS-01–04, 06 refunds, 07 slip (6) | OPS-05 rider (P1, A8), OPS-08 manual order (P2) |
| Catalog admin | CAT-01–06, 08, 09 (6) | CAT-07, 10, 11 (P1) |
| Customers admin | CUS-01 (6) | CUS-02 full profile, 04 (P1), CUS-03 (P2) |
| Promotions admin | PADM-01–03 (6) | PADM-04, 05 (P2), PADM-06 placements (P1) |
| Moderation | MOD-01 (6) | MOD-02 (P2) |
| Settings | SET-01–03, 05 (6) | SET-04 templates, SET-06 VAT (P1) |
| Notifications | NOT-01 (backend; copy on confirmation) | NOT-02–05 |
| Quality | QA-01 perf (all, 4, 7), QA-02 SEO (4), QA-03 a11y (all, 7), QA-04 security (7), QA-05 errors (0, 7), QA-06 events (4), QA-07 tests (0, 7), QA-08 NDPR notice (4) | QA-09 backups (infra) |

---

## 8. Where this plan departs from the design handoff

| Design says | This plan | Why |
|---|---|---|
| Admin login with mandatory 2FA | Email + password only | Decided: 2FA removed for now; the API has no second step |
| Card number/expiry/CVV fields | Paystack popup only | PCI scope (the handoff already overrides its own mockup) |
| Saved card / bank-app express, USSD, pay on delivery | Hidden | API does not support them (P1) |
| (none) Home rendered from an admin-managed section list | Built as designed (A5): sections, layout order and visibility from the API; `quiz` and `ugc` stay hidden until their data exists | |
| Full storefront editor (drafts, undo, history, WYSIWYG) | List/form manager | Needs **A13** |
| Team & roles screen, audit log | Omitted | No API (P1) |
| Customers: fit profile, consent, notes, disable | List, segment tiles (A9) and a light drawer | Remaining profile data is P1 |
| Orders: returns | Omitted. Rider assignment, cancel and refund are built | Returns are P1 |
| Promotions: gift type, placements, calendar, live phone preview | Four kinds, plain-English summary, no calendar | Engine supports four kinds; rest is P1/P2 |
| Dashboard: funnel, live campaigns, new vs returning | KPIs, revenue chart, orders to action, best sellers, categories | Remaining analytics endpoints are P1 |
| Blur placeholders on every image | `next/image` through the CDN; blur only where a dominant colour is supplied | The API stores no image metadata beyond size |
| Desktop storefront | Responsive ≥1024 per the handoff recommendation (top header, 4-up grids, two-column checkout) | The handoff says to confirm with design first (Q2) |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Product editor is large and has real data-loss potential (renaming or deleting values affects many variants) | Build it first in phase 6; impact notes from computed counts; "hide instead of delete" default; the API already deactivates rather than deletes; heavy test coverage of matrix generation |
| Cookie behaviour across browsers (Safari ITP, in-app browsers, Secure on localhost) | Same-site domains confirmed; test on real iOS Safari and Android WebView in phase 2; rewrite-proxy fallback ready (and its `TRUSTED_PROXY_HOPS` trap documented) |
| Paystack popup unreliable in some mobile in-app browsers | `/checkout/return` works from `?reference=` alone; redirect fallback via `authorizationUrl` |
| Cache Components pitfalls (blocking routes, runtime data outside Suspense) | Read the bundled guides per area; `instant` validation on in CI; client components for personalised parts |
| API changes slip | Every change in §5 has a fallback; only A1 (bag display) and A2 (reviews) have real user impact if late |
| Image URLs rotate hourly when no CDN is configured | CDN decided; set `MEDIA_PUBLIC_BASE_URL` in every deployed environment so URLs are stable |
| Scope: 75 days is large | Phase 6 order lets you stop after Products, Orders, Dashboard and Settings and still operate; Promotions, Reviews and Customers can slip a sprint |
| Design has no desktop layouts or admin login | Follow the handoff's recommendations; one short design review before phase 1 and phase 5 |

---

## 10. Definition of done and launch checklist

**Per feature:** typed API calls with error mapping; loading, empty and error states; keyboard and screen-reader behaviour as specified; unit or MSW test for logic; no new `any`; works at 360px width.

**Launch gate:**
- [ ] Purchase e2e (card, transfer pending, declined, expired reservation) green on staging with Paystack test keys; one real live-mode payment and refund done end to end
- [ ] Admin can create a product with variants and images, publish it, and see it on the storefront within a minute
- [ ] Orders move through packed → out for delivery → delivered and the customer's tracking page and SMS agree
- [ ] Lighthouse mobile ≥ 90 (performance, accessibility, SEO) on home, listing, product; budgets in §3.8 met
- [ ] axe: zero serious/critical issues; checkout and product editor keyboard-only pass
- [ ] CSP enforced; no secrets in client bundles; `/admin` is `noindex`
- [ ] Real content in place: WhatsApp number, showroom address, returns/terms/privacy/FAQ pages, delivery zones and fees, payment settings
- [ ] Sentry receiving errors from both apps; Web Vitals reported
- [ ] Tested on iOS Safari, Android Chrome and one in-app browser

---

## 11. Questions that change the plan

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | ~~Hosting split~~ **Parked by you for now.** The frontend needs a Node runtime (`next start`) wherever it lands | Revisit at phase 7 |
| Q2 | Confirm the ≥1024px storefront behaviour (top header, 4-up grids, two-column checkout) with design, or build mobile-only first? | Build the recommendation; it is mostly CSS |
| Q3 | Is a cut-down storefront content manager acceptable at launch (A13 deferred)? | Yes |
| Q4 | ~~Image delivery~~ **Decided: CDN** (`MEDIA_PUBLIC_BASE_URL`); `next/image` through it | Done |
| Q5 | Business rules the design marks "confirm": max 5 per line, the 2,000-variant ceiling, "Out of stock sorted last" | 5 per line; 2,000; sold-out sorted last |
| Q6 | ~~Approve A1–A5, A7–A10~~ **Done and tested** | Done |
| Q7 | Analytics consent: first-party anonymous events with an inline notice, or a consent gate before any events? | Inline notice, no gate |
