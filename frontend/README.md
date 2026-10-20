# @jetty/frontend

The Next.js app: the customer storefront and, later, the `/admin` portal (App Router, TypeScript, Tailwind CSS 4).
The build order and the reasoning behind these choices are in [docs/FRONTEND.md](../docs/FRONTEND.md); the visual
specs are in [design/](./design).

## Run it

From the repository root (`npm install` first):

```bash
npm run dev:web
```

Or from this directory:

```bash
cp .env.example .env.local
npm run dev            # http://localhost:3000
npm run build && npm start
npm run check          # typecheck, lint and unit tests
npm test               # unit and component tests (Vitest)
npm run test:e2e       # browser tests (Playwright); first run: npx playwright install chromium
```

The storefront expects the API on http://localhost:4000. `npm run dev` at the repository root starts both. While
developing, open `/dev/ui` for a catalogue of every UI primitive (it is a 404 in production).

> This is not the Next.js of older tutorials. Before writing code for an area (caching, forms, error files, images),
> read the matching guide in `node_modules/next/dist/docs/`. For example, error boundaries receive `retry`, not `reset`.

## How the app is organised

```
src/
  app/                  routes, layouts, error and not-found pages
  components/ui/        primitives from design/02-components.md (Button, Chip, fields, Media, ...)
  components/providers  TanStack Query + mount-time bootstrap
  lib/api/              the typed API client and one module per domain
  lib/stores/           Zustand stores (cart, sessions, hints); persisted.ts holds the shared helpers
  lib/session/          renews the access token before it expires
  lib/analytics/        batched funnel events and the anonymous visitor/session ids
  lib/format.ts         Naira, Lagos time, Nigerian phone numbers, durations
  lib/status.ts         order status → label and colour
  test/                 Vitest setup and the mock API (MSW)
e2e/                    Playwright tests
```

### Talking to the API

Use the domain modules (`getProducts`, `getQuote`, `placeOrder`, ...) from `@/lib/api`, which is safe in server
components. Account functions (`signIn`, `getMyOrders`, `submitReview`, ...) start and use the browser session, so they
are client-only and come from `@/lib/api/account`. All of them return typed
data and throw `ApiError` carrying the contract's stable `code` and the `requestId`. The client:

- sends cookies to the API's own origin (the refresh token and guest checkout cookies live there);
- attaches the bearer token for `auth: "customer" | "admin"`, refreshes it once on a 401 (shared between concurrent
  requests) and retries; `authOptional` sends the token when there is one and carries on as a guest otherwise;
- takes `idempotencyKey` and `ifMatch`, and exposes the `ETag` through `apiRequest`.

`API_BASE_URL` is used by server components and `NEXT_PUBLIC_API_BASE_URL` by the browser; in production the API sits
on a subdomain of the storefront's domain so its cookies are same-site. Never put a secret in a `NEXT_PUBLIC_`
variable. The Paystack secret key belongs to the API only.

### State

- **Client state is Zustand.** The bag, the signed-in session, analytics ids and (later) the wishlist and checkout
  draft are stores. Persisted ones use `persist` with `skipHydration` and are filled after mount by `<Bootstrap />`,
  so server and first client render match; read the bag count through `useCartCount()`.
- **Server state is TanStack Query** (quotes, orders, reviews, and everything in admin).
- Access tokens live in memory only, never in storage.

### Conventions

- The **client owns the cart**, and it holds only variant ids, quantities and promotion codes. Names, photos, prices and
  totals come from `POST /pricing/quote` every time; never compute a price or discount in the UI.
- Amounts are integer kobo; format with `formatNaira` from `@/lib/format`.
- Cache only public, read-only catalog responses. Never cache customer, bag, checkout or admin responses.
- Styling uses the design tokens (`bg-primary`, `rounded-pill`, `text-heading-md`, ...), never raw hex or pixel values.
  Tailwind 4 has no `duration-*` theme namespace, so motion tokens are written `duration-(--duration-fast)`.
- Every interactive element has a visible focus ring, icon-only buttons have a label, and any `aria-label` contains the
  visible text. Run the gallery through axe when you add a primitive.
