# @jetty/frontend

The Next.js storefront (App Router, TypeScript, Tailwind CSS 4).

## Run it

From the repository root (`npm install` first):

```bash
npm run dev:web
```

Or from this directory:

```bash
cp .env.example .env.local
npm run dev
npm run build && npm start
npm run typecheck
npm run lint
```

The storefront expects the API on http://localhost:4000. `npm run dev` at the
repository root starts both.

## Talking to the API

Use `apiFetch` from [src/lib/api.ts](./src/lib/api.ts). It resolves the base
URL, serialises JSON, attaches `Idempotency-Key` when given, and throws
`ApiError` carrying the contract's stable `code` and the `requestId` for any
non-2xx response.

```ts
import { apiFetch, formatNaira } from "@/lib/api";

const { data } = await apiFetch<{ data: Product }>(`/products/${slug}`);
const price = formatNaira(data.priceMinor);
```

`API_BASE_URL` is used in server components, route handlers and server
actions. `NEXT_PUBLIC_API_BASE_URL` is inlined into the client bundle for
browser calls — never put a secret in a `NEXT_PUBLIC_` variable. The Paystack
secret key belongs to the API only; the browser receives just the public
access code or authorization URL.

## Conventions

- The **client owns the cart**. Persist only variant IDs, quantities and
  promotion codes locally. Never store contact, address or payment data with
  the cart, and never treat local prices or totals as authoritative — the API
  recalculates at quote and checkout time.
- Amounts arrive as integer minor units. Format with `formatNaira`.
- Cache only public, read-only catalog responses. Never cache customer, cart,
  checkout or admin responses.
