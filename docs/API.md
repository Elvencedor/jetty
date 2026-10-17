# Jetty's Hair — API contract proposal

**Status:** Proposed implementation contract  
**Style:** JSON over HTTPS, REST, rooted at `/api/v1`  
**Clients:** Storefront, admin portal, payment-provider webhooks, background
workers

Endpoints marked **P0** are required for launch; **P1/P2** correspond to
post-launch/later features. The authoritative data model is in
[DATABASE.md](./DATABASE.md); deployments are described in
[INFRASTRUCTURE.md](./INFRASTRUCTURE.md).

## Contract rules

- Use JSON request/response bodies with `Content-Type: application/json`.
- Use UUIDs for internal resource IDs and a separate human-readable
  `orderNumber` for customer-facing order references.
- Return UTC ISO 8601 timestamps. Amounts are integer minor units with
  currency, e.g. `{ "amountMinor": 125000, "currency": "NGN" }` = ₦1,250.00.
- Paginate list endpoints with `limit` (default 20, max 100) and opaque
  `cursor`. Response shape: `{ "data": [], "page": { "nextCursor": null } }`.
- Use `Idempotency-Key` for checkout submission, payment/refund operations,
  and any retriable state-changing request. A key is scoped to the
  authenticated principal or a high-entropy checkout request token and bound
  to a request hash.
- Return `ETag`/`If-Match` on admin edits where concurrent updates could
  overwrite data.
- Do not accept client-computed prices as authoritative. Cart and checkout
  requests identify variant IDs and quantities; the API returns calculated
  totals and promotion allocations.
- Cart state belongs to the client. The server exposes no cart persistence
  endpoints and does not trust client-side prices, discounts, availability,
  titles, or totals. Every quote and checkout revalidates submitted variant
  IDs and quantities against PostgreSQL.
- Client cart storage should contain only variant IDs, quantities, and
  promotion codes; do not persist contact/address or payment data with the
  cart. Checkout access tokens are short-lived, opaque, and issued in a
  `Secure`, `HttpOnly`, `SameSite=Lax` cookie for guest status polling.
- Use bearer access tokens for authenticated customer/admin APIs, with
  short-lived access tokens and revocable refresh sessions in secure cookies.
  Admin access requires 2FA. Apply CSRF protection to cookie-authenticated
  state changes.
- Paystack webhooks authenticate the raw request body with
  `x-paystack-signature`; verify transaction, amount, currency, and reference
  server-to-server, and deduplicate events. Never expose webhook secrets or
  trust a payment redirect.

## Common response and error format

Success responses return a resource or `{ "data": resource }`; collection
responses use the pagination envelope above.

```json
{
  "error": {
    "code": "OUT_OF_STOCK",
    "message": "One or more items are no longer available.",
    "requestId": "req_01...",
    "details": [{ "variantId": "uuid", "availableQuantity": 0 }]
  }
}
```

Use standard HTTP statuses: `400` malformed request, `401` unauthenticated,
`403` unauthorized, `404` absent resource, `409` state/idempotency conflict,
`422` valid JSON with invalid fields/business rules, `429` rate limit, and
`5xx` unexpected server failure. Never return stack traces or provider
credentials. Validation errors include stable field paths and error codes.
Cart writes accept an expected cart version; return `409 CART_CHANGED` when
another request has already updated the cart.

## Storefront and customer endpoints

| Method and path | Purpose / contract | Phase |
|---|---|---|
| `GET /storefront/home` | Active homepage content placements and featured product references | P0 |
| `GET /content/pages/{slug}` | Published static page; honors scheduled publish window | P0 |
| `GET /categories` | Active category tree and collection entry points | P0 |
| `GET /collections/{slug}/products` | Cursor page; filters `texture`, `lace`, `length`, `density`, `colour`, `minPrice`, `maxPrice`, `inStock`, `onOffer`; sort `recommended`, `bestSelling`, `newest`, `priceAsc`, `priceDesc`, `topRated` | P0 |
| `GET /products` | Search via `q`, facets, filters, sort, and cursor pagination | P0 |
| `GET /products/suggestions?q=` | Type-ahead product suggestions; rate-limited | P0 |
| `GET /products/{slug}` | Product details, options/variants, media, availability, ratings, active promotion messaging | P0 |
| `GET /products/{productId}/reviews` | Approved reviews and rating summary; sort/filter query params | P0 |
| `POST /reviews` | Authenticated verified-purchase review submission; begins in moderation state | P0 |
| `POST /auth/register` | Create customer from email/password or phone/OTP flow; never return password/hash | P0 |
| `POST /auth/login` | Email/password login; generic credential failure response | P0 |
| `POST /auth/otp/request` | Request rate-limited sign-in/verification OTP | P0 |
| `POST /auth/otp/verify` | Verify OTP and issue session | P0 |
| `POST /auth/password/forgot` | Request reset; non-enumerating response | P0 |
| `POST /auth/password/reset` | Consume one-time reset token and set password | P0 |
| `POST /auth/logout` | Revoke current session | P0 |
| `GET /me` | Current profile; authenticated | P0 |
| `GET, POST /me/addresses` | List/create address book entries | P1 |
| `PATCH, DELETE /me/addresses/{id}` | Update/remove own address; enforce ownership | P1 |
| `GET, PUT /me/preferences` | Read/update channel preferences and consent | P1 |
| `GET, POST /me/payment-methods` | List saved provider-tokenized methods; save via provider setup flow, returning only brand/last four/expiry | P1 |
| `DELETE /me/payment-methods/{id}` | Remove the provider token and local reference | P1 |
| `GET /me/orders` | Authenticated order history | P0 |
| `GET /me/orders/{orderId}` | Own order detail and status timeline | P0 |
| `GET, POST /me/wishlist/items` | List/add wishlist item | P1 |
| `DELETE /me/wishlist/items/{variantId}` | Remove wishlist item | P1 |
| `POST /me/wishlist/items/{variantId}/move-to-cart` | Move saved variant to cart; validate current price and stock | P1 |
| `POST /me/orders/{orderId}/returns` | Request eligible return/exchange; enforce seven-day policy and product condition requirements | P1 |
| `POST /me/data-export` | Create NDPR data export request | P1 |
| `POST /me/data-erasure` | Submit erasure request; preserve legally required financial/order records | P1 |
| `POST /products/{productId}/stock-notifications` | Subscribe by email/phone for a selected unavailable variant | P1 |

### Customer authentication (email and password)

`POST /auth/register` (E.164 `phone` required, `password` of 10-128 characters,
optional `email`) and `POST /auth/login` (`phone` or `email`, plus `password`)
return `{ accessToken, tokenType: "Bearer",
expiresIn, customer }` and set the `jh_refresh` cookie (`Secure`, `HttpOnly`,
`SameSite=Strict`, path `/api/v1/auth`, 30 days). Access tokens are signed
15-minute bearer tokens tied to a session row, so logout revokes them at once.
`POST /auth/refresh` rotates the cookie; presenting a rotated-out token revokes
the whole session. Refresh and logout reject a foreign `Origin`. Login failures
(wrong password, unknown phone/email, blocked account) are identical `401
INVALID_CREDENTIALS`; a duplicate registration is `409 ACCOUNT_EXISTS`.
`POST /auth/logout` returns `204`; `GET /me` returns the profile. Auth routes
return `503 AUTH_UNAVAILABLE` until `AUTH_TOKEN_SECRET` is set.

`POST /checkout`, `GET /checkout/{orderId}/status` and
`POST /checkout/{orderId}/payment-attempts` accept an optional bearer token. With
one, the order belongs to the customer (no guest cookie), per-customer promotion
limits apply, and idempotency keys are scoped to the customer. A bad or revoked
token is `401`; it is never treated as a guest.

### Client cart and pricing

| Method and path | Purpose / contract | Phase |
|---|---|---|
| `POST /pricing/quote` | Stateless quote for submitted variant IDs/quantities, promotion codes, and delivery address; returns current server-calculated prices, eligibility, stock warnings, and expiry; no reservation or redemption mutation | P0 |
| `GET /promotions/available` | List currently eligible public offers for the supplied item/delivery context | P1 |

The storefront adds/removes lines, persists the cart locally if desired, and
submits its current contents when requesting a quote or checking out. Quote
results are display estimates; checkout recalculates rather than trusting a
client-supplied quote ID, price, or total.

Example quote:

```json
{
  "currency": "NGN",
  "lines": [{
    "variantId": "uuid",
    "quantity": 1,
    "unitPriceMinor": 25000000,
    "discountMinor": 2500000,
    "promotionAllocations": [{ "promotionId": "uuid", "amountMinor": 2500000 }]
  }],
  "subtotalMinor": 25000000,
  "discountMinor": 2500000,
  "deliveryFeeMinor": 1500000,
  "taxMinor": 0,
  "totalMinor": 24000000,
  "quoteId": "uuid",
  "quoteExpiresAt": "2026-10-13T23:59:00Z"
}
```

Quote requests contain `items` (`variantId`, `quantity`), optional
`promotionCodes`, and optionally `deliveryAddress` (`state`, optional `area`,
`city`, `countryCode`) together with `deliveryMethod`. Unknown fields,
including client-supplied prices or totals, are rejected with `422`. Beyond the
example above, the response includes:

- `promotions.applied` and `promotions.rejectedCodes` (`INVALID_CODE`,
  `EXPIRED`, `USAGE_LIMIT_REACHED`, `NOT_ELIGIBLE`, `MIN_SPEND_NOT_MET`,
  `NOT_APPLICABLE`). A bad code never fails the quote.
- `warnings`: `OUT_OF_STOCK` / `INSUFFICIENT_STOCK` per variant, and
  `CUSTOMER_ELIGIBILITY_VERIFIED_AT_CHECKOUT` when a first-order
  promotion cannot be checked for an anonymous buyer. Promotions with a
  per-customer limit are never applied to guests; a submitted code for one is
  rejected as `NOT_ELIGIBLE`.
- `delivery` (`method`, `zoneName`, `baseFeeMinor`, `feeMinor`,
  `freeDeliveryPromotionId`, `estimate`) when a destination was supplied.

Promotions resolve deterministically by priority (descending), then creation
time. Line discounts after the first apply only if every involved promotion is
`stackable`; free delivery targets the delivery fee and always combines.
Minimum spend is measured on a promotion's eligible lines before discounts.
Unavailable or unpublished variants return `422 VARIANT_UNAVAILABLE` with the
offending `variantId`s.

### Delivery, checkout, payment, and tracking

| Method and path | Purpose / contract | Phase |
|---|---|---|
| `POST /delivery/quotes` | Resolve zone, method, price, ETA and same-day eligibility from destination and cart | P0 |
| `POST /checkout` | Accept client-submitted lines/contact/delivery/coupon/consent; recalculate; atomically create `pending_payment` order snapshot, payment attempt, and stock reservations; initialize Paystack; return order/payment references and Paystack action; set a guest checkout access-token cookie where needed | P0 |
| `POST /checkout/{orderId}/payment-attempts` | Retry Paystack initialization only after the previous attempt is definitively failed/expired and while the order reservation remains valid; creates a new payment reference; idempotent | P0 |
| `GET /checkout/{orderId}/status` | Return minimal payment/order status to owning customer or guest presenting the short-lived checkout access-token cookie | P0 |
| `POST /checkout/paystack/verify` | Verify a Paystack transaction server-to-server by reference after the client returns; apply the same idempotent state transition as a valid webhook | P0 |
| `POST /orders/track` | Guest lookup by order number plus phone; POST body only (never put phone in URL/query); rate-limit and return minimal timeline | P0 |
| `POST /webhooks/paystack` | Verify `x-paystack-signature` against the raw body; deduplicate; verify transaction server-to-server; reconcile amount/currency/reference; update payment/order atomically; respond quickly | P0 |
| `POST /checkout/{orderId}/cancel` | Cancel an unpaid order and release reservation when policy permits; idempotent | P2 |
| `POST /checkout` with `paymentMethod: "ussd"` | Initialize Paystack USSD channel | P1 |
| `POST /checkout` with `paymentMethod: "pay_on_delivery"` | Validate Lagos location and configured POD rules; do not initialize online payment | P1 |

Delivery fees are admin-configured per zone (`delivery_zones`), not computed
from distance or a carrier. A zone matches on `state`; a zone that lists the
destination `area` wins over a state-wide zone. `POST /delivery/quotes` takes
`items`, optional `promotionCodes`, and `deliveryAddress`, and returns the
resolved `zone` plus an `options` entry per configured method (`same_day`,
`next_day`, `nationwide`, `pickup`) with `available` (`reason: "CUTOFF_PASSED"`
after the zone's local same-day cutoff), `baseFeeMinor`, `feeMinor` (after any
free-delivery promotion), and a local-date `estimate`. A destination with no
active zone returns `422 DELIVERY_UNAVAILABLE`; a method the zone does not
offer returns `422 DELIVERY_METHOD_UNAVAILABLE`.

The client cart is not persisted by the API. At checkout submission, the API
revalidates the cart and creates a durable `pending_payment` order snapshot
plus payment attempt and stock reservation before initializing Paystack. The
order is not accepted for fulfillment, counted as a completed sale, or
reported as paid until verified payment. A failed attempt leaves the order
pending while retry is allowed; only one active attempt may exist per order.
On an ambiguous timeout, reconcile the existing Paystack reference before
starting another attempt. A client redirect is not proof of payment. For bank
transfer, Paystack may leave the payment pending while the
one-time account details are shown; expire and release the reservation
according to the configured transfer window.

If Paystack initialization definitively fails, mark that attempt failed and
keep the order retryable only while its reservation is valid. If the API
times out after sending the initialization request, keep the attempt in
`initializing` and reconcile by reference before retrying. If a verified
charge arrives after the order was cancelled or another attempt already
settled, persist the charge and flag the order for payment exception handling;
do not fulfill an order whose stock reservation was released.

Paystack Initialize Transaction is called only by the API using the secret
key. Pass the order email, NGN amount in kobo, currency, unique generated
reference, configured callback URL, enabled channel(s), and opaque order/
payment IDs in metadata.
Return Paystack's `access_code`, `authorization_url`, and `reference` to the
client as needed for Inline or hosted checkout. Keep the secret key server
side; never accept an amount, reference, or payment status asserted by the
client as authoritative.

## Admin endpoints

Admin endpoints require admin authentication; enforce role permissions on
every request (P0 owner-only baseline; granular roles are P1). List endpoints
support cursor pagination and validated filters. Mutations write audit events
when audit logging is enabled.

| Method and path | Purpose | Phase |
|---|---|---|
| `POST /admin/auth/login`, `POST /admin/auth/2fa/verify`, `POST /admin/auth/logout` | Admin session and mandatory 2FA | P0 |
| `GET /admin/dashboard?from=&to=` | Revenue, orders, AOV, prior-period comparison, top products/categories, action counts | P0 |
| `GET /admin/products`, `POST /admin/products` | Search/filter products; create draft | P0 |
| `GET /admin/products/{id}`, `PATCH /admin/products/{id}` | Edit catalog fields; require `If-Match` for concurrent edits | P0 |
| `POST /admin/products/{id}/publish`, `POST /admin/products/{id}/archive` | Publish/archive product | P0 |
| `PUT /admin/products/{id}/variants` | Upsert variant matrix/SKU/prices/option values; validate unique combinations | P0 |
| `POST /admin/media/upload-intents` | Issue short-lived object-storage upload URL; validate type/size; finalize media through API | P0 |
| `GET, POST /admin/categories` and `/admin/collections` | Manage categories and collections | P0 |
| `PATCH /admin/inventory/{variantId}` | Adjust stock with reason; append inventory movement, do not overwrite ledger | P0 |
| `GET /admin/orders`, `GET /admin/orders/{id}` | Filter/search orders and fetch detail/timeline | P0 |
| `PATCH /admin/orders/{id}/status` | Validated fulfillment transition; append event and enqueue notification | P0 |
| `POST /admin/orders/{id}/confirm-transfer` | Reconcile/confirm transfer with provider evidence or documented manual reason; idempotent | P0 |
| `POST /admin/promotions`, `GET /admin/promotions`, `GET /admin/promotions/{id}`, `PATCH /admin/promotions/{id}` | Create/list/edit scheduled automatic or code promotions and their rules | P0 |
| `POST /admin/promotions/{id}/activate`, `POST /admin/promotions/{id}/deactivate` | Explicit state changes; scheduling still enforced by server | P0 |
| `GET /admin/content`, `POST /admin/content`, `PATCH /admin/content/{id}` | Manage banners, announcements, featured products, and static pages | P0 |
| `GET /admin/customers` | Search customers, order count and lifetime value | P0 |
| `GET /admin/reviews?status=pending`, `PATCH /admin/reviews/{id}` | Moderate review approve/reject/hide | P0 |
| `GET /admin/analytics/revenue?from=&to=&interval=` | Revenue series with prior-period series | P0 |
| `GET /admin/analytics/products?from=&to=` | Top products and category sales | P0 |
| `GET /admin/analytics/promotions?from=&to=` | Redemptions, attributed orders, revenue | P1 |
| `GET, PATCH /admin/settings/{key}` | Read/update allow-listed store settings, delivery zones, policies, and payment methods | P0 |
| `GET /admin/audit-log` | Search admin actions | P1 |
| `POST /admin/orders/{id}/refunds` | Full/partial provider refund; idempotent; role-gated | P1 |
| `PATCH /admin/orders/{id}/delivery` | Assign rider/carrier and tracking data | P1 |
| `GET /admin/analytics/export` | Create/download authorized CSV export | P1 |
| `POST /admin/team/invitations`, `GET /admin/team`, `PATCH /admin/team/{id}` | Invite and manage role-assigned staff | P1 |

Use an order state machine: `pending_payment -> placed -> packed ->
out_for_delivery -> delivered`. Payment state is tracked separately:
`pending -> paid -> refunded`; a definitively failed/expired final attempt
sets `failed`. A failed payment attempt does not mark an order failed while a
retry remains possible. `payment_exception` flags a verified late or
duplicate charge for operations. `cancelled` and `refunded` require explicit
permission and business validation. A confirmed successful payment must not
be regressed by a late failure event.

## Request/response examples

### Initialize Paystack checkout

`POST /api/v1/checkout` with `Idempotency-Key`:

```json
{
  "items": [{ "variantId": "uuid", "quantity": 1 }],
  "promotionCodes": ["WELCOME"],
  "contact": { "email": "buyer@example.com", "phone": "+2348012345678" },
  "deliveryAddress": {
    "recipientName": "Buyer",
    "addressLine1": "12 Example Street",
    "area": "Lekki",
    "city": "Lagos",
    "state": "Lagos",
    "countryCode": "NG",
    "landmark": "Near the junction",
    "riderNote": "Call on arrival"
  },
  "deliveryMethod": "same_day",
  "paymentMethod": "card",
  "termsAccepted": true
}
```

Return `201` with the `orderId`, public `orderNumber`, current quote snapshot,
reservation expiry, `paymentAttemptId`, Paystack `reference`, `accessCode`,
and `authorizationUrl`. The API calculates the total and initializes the
transaction; do not accept `quoteId` as a checkout price lock. Return
`409 OUT_OF_STOCK` or a re-quote response if the submitted cart is no longer
valid.

Checkout requires an `Idempotency-Key` header (16-128 characters of
`A-Za-z0-9._~-`). The same key with the same payload replays the stored
response; with a different payload it returns `409 IDEMPOTENCY_KEY_REUSED`;
while the first request is still running it returns `409 IDEMPOTENCY_IN_PROGRESS`.
A request rejected before an order exists (validation, stock, delivery) frees the
key. A claim that never completed (crash or 5xx) is reaped by the worker after
15 minutes and completed keys after 24 hours; any order it created is unpaid and
expires with its reservation. Only `paymentMethod: "card"` is accepted until USSD and pay-on-delivery (P1)
are built. Guest orders get an opaque token in the `jh_checkout` cookie
(`Secure`, `HttpOnly`, `SameSite=Lax`); only its hash is stored.

If Paystack refuses initialization the response is `502
PAYMENT_INITIALIZATION_FAILED`; if the outcome is unknown it is `502
PAYMENT_INITIALIZATION_PENDING`. Both include the `orderId` in `details`; the
order and its reservation stay valid and the attempt is `failed` or
`initializing` respectively. Promotion redemptions are recorded when payment is
verified, not at checkout.

Related checkout endpoints:

- `GET /checkout/{orderId}/status` returns only `orderId`, `orderNumber`,
  `status`, `paymentStatus`, `amountMinor`, `currency`, `reservationExpiresAt`
  and the latest `paymentAttempt` (`id`, `status`). It requires the owning
  customer or the guest `jh_checkout` cookie; any mismatch or expired token is
  `404`.
- `POST /checkout/paystack/verify` takes `{ "reference" }`, looks the
  transaction up with Paystack, and applies the same idempotent transition as
  the webhook. It returns the same minimal status. An unknown reference is
  `404`; an unreachable provider is `503 PAYMENT_VERIFICATION_UNAVAILABLE`.
- `POST /checkout/{orderId}/payment-attempts` (with `Idempotency-Key`, owner
  only) starts a new attempt with a new reference. It first reconciles any
  initializing/pending attempt with Paystack: `409 ORDER_ALREADY_PAID` if it
  was in fact paid, `409 PAYMENT_ATTEMPT_ACTIVE` if still in progress (an
  attempt Paystack has never seen is abandoned only after 2 minutes), and
  `409 ORDER_NOT_PAYABLE` once the order is cancelled or its reservation has
  expired.

Limited promotions (total, per-code or per-customer limits) are first come,
first served: checkout holds a slot for the unpaid order, so later quotes and
checkouts no longer receive the discount, and a checkout that loses a race for
the last slot is `409 PROMOTION_UNAVAILABLE` (re-quote and retry). The hold
becomes a redemption on confirmed payment and is released when the reservation
expires.

Payment confirmation (webhook or verify) runs one transaction under a lock on
the order: it marks the attempt `succeeded`, sets `payment_status = paid` and
`status = placed`, consumes the reservation (decrementing on-hand stock and
writing an `inventory_movements` sale row), records promotion redemptions and
increments usage counters, appends the status event, and queues the
confirmation in the outbox. Promotion usage is claimed only here, never at
quote or checkout, and exactly once per order. A confirmed charge is never
discarded: a charge for an expired/cancelled order becomes `payment_exception`
(`payment_status = paid`, no stock consumed), a second charge on a paid order
leaves it untouched and is flagged, and an amount or currency mismatch sets
`payment_exception` without marking the attempt succeeded. Each case queues an
operations alert (`payment.exception`). When a reservation expires, the order
is cancelled (`payment_status = failed`), its attempts expire, and the stock is
released once.

### Paystack response example

```json
{
  "orderId": "uuid",
  "orderNumber": "JH-20261014-0001",
  "paymentAttemptId": "uuid",
  "provider": "paystack",
  "reference": "ps_opaque_random_reference",
  "accessCode": "opaque_access_code",
  "authorizationUrl": "https://checkout.paystack.com/...",
  "amountMinor": 24000000,
  "currency": "NGN",
  "reservationExpiresAt": "2026-10-14T01:00:00Z"
}
```

The browser uses the returned access code with Paystack Inline or redirects to
the authorization URL. On return, it calls the verification/status endpoint;
the API verifies with Paystack and reconciles with the webhook path. Persist
the provider reference and expected amount before calling Paystack; persist
the provider transaction ID when returned by Paystack or received in its
webhook.

## Operational requirements

- Rate-limit login, OTP, password reset, guest tracking, review submission,
  coupon validation, and webhooks; use separate limits per IP/account.
- Validate and normalize input at the API boundary. Enforce ownership checks
  for customer resources and permissions for each admin action.
- Use an outbox transaction when a state change must trigger email, WhatsApp,
  SMS, or another background action. Delivery is at-least-once; consumers
  deduplicate by event ID.
- Return a `requestId` on every response and propagate it to logs, webhook
  events, jobs, and payment metadata.
- Track and alert on payment/checkout failures, webhook lag, outbox backlog,
  inventory reservation expiry, and API error/latency rates.

## Phone-first identity, order history and rate limits (implemented)

Customers are identified by phone number; email is optional everywhere,
including checkout (`contact.email`). When there is no email, Paystack receives
a per-phone placeholder on `PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN`, which is never
stored on the order, and notifications go by SMS only.

`GET /me/orders` (`limit` 1-50, `cursor`) and `GET /me/orders/{orderId}` need a
bearer token; other customers' and guest orders return `404`. `POST /orders/track`
takes `{ orderNumber, phone }` and returns only status, payment status, delivery
method, placed time and a timeline; a wrong phone and an unknown order are the
same `404`.

Limits are Postgres-backed fixed windows (`rate_limit_buckets`), answered with
`429 RATE_LIMITED` and `Retry-After`: register 10/h/IP, login 30/15m/IP and
8/15m/account, refresh 60/15m/IP, track 20/15m/IP and 10/h/order number, quote
60/m/IP, checkout 20/10m/IP, payment attempts and verify 30/10m/IP, webhook
600/m/IP. Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the API
so `x-forwarded-for` is trusted. The worker purges stale buckets. The limiter
fails open if the database errors.
