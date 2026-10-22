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
  Admin sign-in is email and password for now (2FA is deferred; the schema keeps its columns). Apply CSRF protection to cookie-authenticated
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
| `POST /auth/register` | Create customer from email and password (phone optional); never return password/hash | P0 |
| `POST /auth/login` | Email/password login; generic credential failure response | P0 |
| `POST /auth/google` | Sign in or register with a Google ID token (verified server-side; links to an existing account by verified email) | P1 |
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

`POST /auth/register` (`email` and `password` of 10-128 characters required,
optional E.164 `phone`) and `POST /auth/login` (`email` plus `password`)
return `{ accessToken, tokenType: "Bearer",
expiresIn, customer }` and set the `jh_refresh` cookie (`Secure`, `HttpOnly`,
`SameSite=Strict`, path `/api/v1/auth`, 30 days). Access tokens are signed
15-minute bearer tokens tied to a session row, so logout revokes them at once.
`POST /auth/refresh` rotates the cookie; presenting a rotated-out token revokes
the whole session. Refresh and logout reject a foreign `Origin`. Login failures
(wrong password, unknown email, blocked account) are identical `401
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
  `SIGN_IN_FOR_OFFERS` when an offer was withheld because the buyer is a guest.
  First-order-only promotions and promotions with a per-customer limit are never
  applied to guests; a submitted code for one is rejected as `NOT_ELIGIBLE`.
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
| `POST /admin/auth/login`, `POST /admin/auth/refresh`, `POST /admin/auth/logout` | Admin session (email and password) | P0 |
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
| `POST /admin/orders/{id}/refunds` | Full/partial provider refund; idempotent; role-gated | P0 (pulled forward to resolve duplicate and late charges) |
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

- Rate-limit login, password reset, guest tracking, review submission,
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

## Identity, order history and rate limits (implemented)

Customer accounts are identified by **email and password**. Checkout stays open to guests, where the phone number is
required (delivery needs it) and email is optional (`contact.email`). When a guest gives no email, Paystack receives
a per-phone placeholder on `PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN`, which is never
stored on the order, and notifications go by SMS only.

`GET /me/orders` (`limit` 1-50, `cursor`) and `GET /me/orders/{orderId}` need a
bearer token; other customers' and guest orders return `404`. `POST /orders/track`
takes `{ orderNumber, phone }` and returns only status, payment status, delivery
method, placed time and a timeline; a wrong phone and an unknown order are the
same `404`.

Limits are Redis-backed fixed windows (atomic Lua `INCR` + TTL, keys hashed), answered with
`429 RATE_LIMITED` and `Retry-After`: register 10/h/IP, login 30/15m/IP and
8/15m/account, refresh 60/15m/IP, track 20/15m/IP and 10/h/order number, quote
60/m/IP, checkout 20/10m/IP, payment attempts and verify 30/10m/IP, webhook
600/m/IP. Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the API
so `x-forwarded-for` is trusted. Redis expires counters itself. `REDIS_URL` is required
when `RATE_LIMIT_ENABLED` is true, and the service fails at startup if Redis is
unreachable; once running, the limiter fails open if Redis errors.

## Password reset codes and notification delivery (implemented)

Phone sign-in codes (`/auth/otp/*`) were removed: customers sign in with email and password, and Google sign-in is the
planned alternative (`POST /auth/google`, P1: the client sends a Google ID token, the API verifies it with Google,
and links it to an account by *verified* email, never by an unverified one).

`POST /auth/password/forgot` (`{ email }`) always returns `202`, with an identical body for unknown accounts. For a
known account it emails a six-digit code that expires after ten minutes, allows 5 wrong guesses and works once; a new
code replaces the old one, and requests within 60 seconds of the last one are ignored silently. `POST
/auth/password/reset` (`{ email, code, password }`) returns `204`, ends every session of the account and marks the
email as verified. Every failure is `401 INVALID_CODE`. Limits: forgot is 10/15m/IP and 5/h/email; reset is
20/15m/IP and 10/15m/email.

Registration does not require proving the email. Someone who registers an address that is not theirs cannot keep it:
the real owner resets the password with a code sent to that address, which also signs the first registrant out.

The worker sends the outbox every 5 seconds. Rows are claimed with
`FOR UPDATE SKIP LOCKED` and a 2-minute lease, so several workers are safe and a
crashed worker's rows are retried. Delivery is at-least-once. Transient
failures retry with backoff (30s doubling, capped at 1h) up to 6 attempts;
provider rejections fail at once. Failed rows stay in `notification_outbox` with
`last_error`, and the worker logs an error when the oldest undelivered row has
waited over 5 minutes. Providers are Termii (SMS) and Resend (email); `log`
prints messages for development and is refused in production.


## Storefront content, reviews and bank transfer (implemented)

`GET /storefront/home` returns `{ announcements, sections }` (see "Contract additions for the frontend" below for the
section shapes). Content is published and inside its schedule window, or it does not appear.
`GET /content/pages/{slug}` serves a published `page` (`{ slug, title, markdown, updatedAt }`; the storefront renders
the markdown, so it must sanitise it). `GET /storefront/settings` exposes the public store details, policies and
enabled payment methods. `GET /products/suggestions?q=` (2+ chars, `limit` 1-10, 120/min/IP) matches word prefixes of
visible product titles.

`GET /products/{productId}/reviews` (`sort` newest|highest|lowest, `rating`, `limit`, `cursor`) returns only approved
reviews, a `summary` (`average`, `count`, `breakdown` 1-5) and the usual `page.nextCursor`. `POST /reviews`
(bearer) takes `{ orderItemId, rating, title?, body?, location? }`: the item must be on the caller's own paid and
**delivered** order, once per item (`409 REVIEW_EXISTS`, `422 REVIEW_NOT_ELIGIBLE`, 404 for someone else's item).
New reviews are `pending` until moderated. 10/hour/customer.

`POST /analytics/events` takes `{ events: [{ name, anonymousId, sessionId, occurredAt?, properties }] }` (1-20) for
`session_start`, `product_view`, `add_to_bag`, `checkout_start`, with `properties` limited to `productId`,
`variantId`, `quantity`, `source`. There is no `purchase` event: sales are counted from paid orders. Conversion rate
on the dashboard is paid orders divided by distinct sessions, and is `null` when no events were recorded.

`POST /checkout` accepts `paymentMethod: "bank_transfer"` as well as `"card"`. The provider is initialised with the
`bank_transfer` channel, stock is held for the configured transfer window (default 45 minutes), and a retry keeps the method. A method can be
switched off in settings (`422 PAYMENT_METHOD_UNAVAILABLE`). The transfer is settled by the same verified webhook /
verify path as a card; an admin can also confirm it (below).

## Admin API (implemented)

**Authentication.** `POST /admin/auth/login` (`{ email, password }`) returns a 15-minute bearer `accessToken` with the
admin's roles and permissions, and sets an HttpOnly `jh_admin_refresh` cookie (path `/api/v1/admin/auth`, 12 hours,
rotated on `POST /admin/auth/refresh`; replaying a rotated token revokes the session). `POST /admin/auth/logout`,
`GET /admin/me`. Admin and customer tokens use different signing keys and are not interchangeable. Unknown email, wrong
password and disabled account are indistinguishable in response and timing. Limits: 20/15m/IP, and 8/15m per
email-and-IP pair, so an outsider cannot exhaust the real admin's attempts from another address. These two checks
**fail closed**: if Redis cannot be reached, sign-in returns `503` rather than allowing unlimited guessing. There is
no 2FA, invitation or admin password-reset flow yet: the first owner comes from `npm run db:seed`, and a forgotten
password is reset in the database.

**Authorization.** Each route declares the permission it needs and is refused otherwise; a route with none declared is
refused too. `*` grants everything and `x:write` implies `x:read`. Roles are seeded (`npm run db:seed`):

| Role | Permissions |
|---|---|
| owner | `*` |
| manager | `catalog:write`, `orders:write`, `promotions:write`, `content:write`, `customers:read`, `analytics:read`, `inventory:write`, `reviews:moderate`, `settings:read`, `orders:refund` |
| fulfilment | `orders:read`, `orders:fulfil`, `inventory:read` |
| content_editor | `content:write`, `catalog:read` |
| support | `orders:read`, `customers:read`, `reviews:moderate` |

Permissions are read on every request, so disabling an admin or changing a role takes effect immediately. Every
mutation appends to `admin_audit_log` (actor, action, before/after, request id).

**Catalog.** Lists use `limit`/`cursor`. `GET/POST /admin/products`, `GET/PATCH /admin/products/{id}` (PATCH needs
`If-Match`: `428` if missing, `412` if stale; every response carries the new `ETag`), `POST .../publish` (needs an
active variant; optional `publishAt`) and `.../archive`. `PUT /admin/products/{id}/variants` (needs `If-Match`) replaces the option and
variant matrix: variants are matched by `id`, then option combination, then SKU; ones left out are deactivated, never
deleted (orders and reservations point at them); `stock` only seeds new variants. `/admin/categories` and
`/admin/collections` (GET, POST, PATCH; category cycles are refused), `PUT /admin/collections/{id}/products`.
`GET /admin/inventory` (`filter=low|out`), `PATCH /admin/inventory/{variantId}` (`mode` adjust|set, `reason`;
appends to `inventory_movements`; `409 STOCK_BELOW_RESERVED`).

**Media.** `POST /admin/media/upload-intents` returns a server-chosen `objectKey` under `products/{id}/` and a
presigned `PUT` (5 minutes; content type and length are part of the signature; JPEG/PNG/WebP/AVIF, 10 MB). After the
browser uploads, `POST /admin/products/{id}/media` verifies the object exists, then registers it (first image becomes
the cover). `PATCH`/`DELETE .../media/{mediaId}`. Configure `MEDIA_S3_*`; without them intents return `503`.

**Orders.** `GET /admin/orders` (`q`, `status`, `paymentStatus`, `from`, `to`), `GET /admin/orders/{id}` (items,
payments, timeline, delivery, notes, `allowedTransitions`). `PATCH /admin/orders/{id}/status` moves a **paid** order one
step: `placed -> packed -> out_for_delivery -> delivered` (pickup orders go `packed -> delivered`), under a row lock,
appending a timeline event and queuing SMS (and email, if given) in the same transaction (`409 INVALID_TRANSITION`,
`409 ORDER_NOT_PAID`). `POST .../notes` records an internal note, never shown to the customer. `POST
.../confirm-transfer` asks the provider first and settles through the normal path; if the provider has nothing, a
`manualReason` (10+ chars) settles it by hand, audited. Repeating it on a paid order is a no-op.

**Promotions.** `GET/POST /admin/promotions`, `GET/PATCH /admin/promotions/{id}`, `POST .../activate|deactivate`.
Rules are validated with the pricing engine's own versioned schemas (unknown keys are refused); `free_gift` is not
creatable until it is supported. Codes are normalised and unique; they are upserted by PATCH and deactivated, never
deleted. A live automatic promotion cannot gain its first code. Listed status is derived: `draft`, `inactive`,
`scheduled`, `live`, `ended`; the worker marks ended ones `expired`. Editing an ended promotion requires moving its end date.

**Content, customers, reviews, settings.** `GET/POST /admin/content`, `GET/PATCH /admin/content/{id}` for
`announcement`, `banner`, `page` and `featured_products` (body validated per type; only `http(s)` or site-relative
URLs). `GET /admin/customers` (`q`, `sort` newest|spend; order count and lifetime value over paid orders),
`GET /admin/customers/{id}`. `GET /admin/reviews` (`status`, `productId`), `PATCH /admin/reviews/{id}`
(`approved|rejected|hidden`). `GET/PATCH /admin/settings/{key}` for `store`, `policies`, `payments` and
`delivery-zones` only (PATCH merges fields; `delivery-zones` takes `{ zones: [...] }`, creating or updating; zones are
retired with `active: false`, never deleted). Settings writes are owner-only.

**Analytics.** `GET /admin/dashboard`, `GET /admin/analytics/revenue` (`interval` day|week|month) and
`GET /admin/analytics/products`, with `from` (inclusive) and `to` (exclusive), default the last 30 days, at most 366
days. The previous period is the same length immediately before. Sales are paid, non-refunded orders by the time
payment was confirmed; series are bucketed in `Africa/Lagos` and gap-filled. `GET /admin/orders-to-action` gives
counts to pack, dispatch, deliver, awaiting transfer and payment exceptions.

## Changes after the first review (implemented)

**Refunds.** `POST /admin/orders/{id}/refunds` (`orders:refund`: owner and manager; `Idempotency-Key` required) takes
`{ reason, amountMinor?, paymentAttemptId? }`. It refunds a *successful* payment through Paystack, fully or in part
(`amountMinor` defaults to what is left of that payment). The refund row reserves its amount before the provider is
called, under the order lock, so repeats and concurrent requests cannot refund the same money twice. A refusal
(`422 REFUND_REJECTED`) releases the amount; a timeout returns `502 REFUND_STATUS_UNKNOWN` and keeps it reserved until
someone checks the provider dashboard. When an order has two successful payments (a duplicate charge) `paymentAttemptId`
is required (`422 PAYMENT_ATTEMPT_REQUIRED` lists them); refunding the extra charge leaves the order intact. The order
becomes `refunded` only when what the customer paid, net of refunds, reaches zero; a partial refund adds an internal
`PARTIAL_REFUND` annotation, which the customer's timeline does not show. A payment confirmed by hand has no provider
charge (`409 MANUAL_PAYMENT_NOT_REFUNDABLE`) until the provider reports one. Stock is not returned automatically. The
status Paystack reports (`pending`, `processing`, ...) is stored as given; refund webhooks are not processed yet.

**Double payments.** If an admin confirms a transfer by hand and the provider later reports a real charge for the same
reference, settlement records the provider's transaction id, adds a timeline annotation and raises a
`payment.exception` alert (`PROVIDER_CHARGE_AFTER_MANUAL_CONFIRMATION`). This may be the same money arriving late or a
genuine second payment; a person decides, and refunds the extra charge if the customer shows it. Alerts are logged, and
emailed to `OPS_ALERT_EMAIL` when set.

**Guests and offers.** First-order-only promotions and promotions with a per-customer limit are never applied to
guests. A submitted code for one is rejected `NOT_ELIGIBLE`, and the quote carries a `SIGN_IN_FOR_OFFERS` warning.
Guest `POST /checkout` requires an `Idempotency-Key` of at least 32 characters (use a UUID): the key is what protects a
replay, and the guest checkout token is derived from it with the server secret, so a replayed request hands back the
same `jh_checkout` cookie.

**Images.** Admins upload straight to the bucket with a presigned `PUT`; the API stores only object keys. Storefront and
admin responses add a `url`, a presigned `GET` for the private bucket (also `imageUrl` on banners and `coverUrl` in the
admin product list). URLs are signed at the start of the hour and valid for two, so a given image has the same URL for
an hour and can be cached. With `MEDIA_PUBLIC_BASE_URL` set (a CDN in front of the bucket) `url` is instead a stable
public URL built from the key, which is what production should use. There is no image scanning or resizing; the client
uploads what it wants displayed.

**Contract.** `GET /me/orders` now returns `{ data, page: { nextCursor } }` and accepts `limit` up to 100.
`PUT /admin/products/{id}/variants` requires `If-Match` like the product PATCH. Every response carries HSTS,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. `payments` settings gain
`cardHoldMinutes` (default 30) and `transferHoldMinutes` (default 45), each 15 to 480; Paystack documents a 30 minute
life for transfer account numbers in one place and up to 8 hours in another, so confirm the figure for your account.
Admin mutations are written in the same transaction as their audit record: if the audit write fails, the change does not
happen. The API refuses to start on Railway unless `NODE_ENV` is set.

**Data retention.** The worker deletes sessions 7 days after they expire or are revoked, delivered notifications after
14 days, failed ones after 30, and analytics events after 90. Pending messages are never deleted. The notification outbox
is kept (not replaced by inline sending) because it is what guarantees a one-time code or order message survives a crash
or a provider outage. There is no `payment_webhook_events` table: a payment attempt records the last event key it
applied (`webhook_event_key`, `webhook_received_at`), settlement is idempotent, and events matching no attempt are logged.

## Contract additions for the frontend (implemented)

**Quote and checkout lines** (`POST /pricing/quote`, and `quote.lines` in the `POST /checkout` response) now describe
themselves: `productId`, `slug`, `title`, `image` (`url`, `altText`, `width`, `height`), `options` (`[{ name, label }]`
in option order), `optionSummary` (`14" · Jet black`), `compareAtPriceMinor` (the struck "was" price, or `null`) and
`availableQuantity`. The contract refuses client-supplied prices, so there is no `priceChanged` flag: a client that
wants "price updated from ₦X" compares the new `unitPriceMinor` with the one it showed before.

**Listings** (`GET /products`, `GET /collections/{slug}/products`) return `page: { nextCursor, total }` (`total` only on
the first page) and richer cards: `colours` (`[{ label, valueKey, swatch }]` of colours that can be bought),
`lengthRange` (`{ min, max }` inches or `null`) and `badges` (`[{ kind, label }]`, kinds `custom`, `sale` with the
biggest discount, `low_stock`, `new` for products published in the last 14 days, `featured`). Promotion badges such as
"Buy 1 Get 1" are not on cards; they come from the quote. `GET /products/facets` takes the listing filters (plus `q`,
`category`, `collection`; no `sort`/`limit`/`cursor`) and returns `{ options: { texture, lace, length, density, colour:
[{ valueKey, label, swatch, count }] }, price: { minMinor, maxMinor }, inStockCount, onOfferCount }`. Each option's counts
ignore that option's own selection and the price range ignores the price filter. Counts are of products having some
buyable variant with the value, so they can slightly overstate; the listing `total` is exact. Numeric values sort as
numbers.

**Product detail** adds `swatch` on option values, `defaultVariantId` (the best-selling variant that is in stock, else the
best seller, ties to the cheaper), `soldCount`, and `details` as exactly `{ details, fit, care, delivery }` (markdown or
`null`). Admins can only write those four keys, and `swatch` (`#rrggbb`) is saved through the variant matrix.

**Home sections.** `sections` is an ordered list; a block with nothing to show is omitted. Types: `stories` (`items`),
`hero` (`cards` with `tag`, `headline`, `subheadline`, `tone`, `ctaLabel`, `ctaUrl`, `imageUrl`, `endsAt`), `flash`
(`headline`, `code`, `endsAt`, `promotionId`; only while its promotion is live and has an end), `products` (`title` and
`tabs` `featured`, `deal`, `care` of product cards), `length` (`items` with `lengths` in inches), `tiles` (up to three),
`trust` (icons, titles, captions; returns and same-day entries appear only when configured). `quiz` and `ugc` are
reserved and render nothing yet. Content types for admins: `announcement`, `banner`, `story`, `tile`, `flash`,
`featured_products`, `page`, and `home_layout` (a singleton, slug `home`, `{ sections: [{ type, enabled }] }`; listed
blocks show in that order, unlisted or disabled blocks are hidden, and with no layout every block shows in canonical order).

**Orders.** `GET /me/orders/{id}` items gain `id` (the `orderItemId` for `POST /reviews`), `slug`, `image` and
`reviewable` (delivered, paid and not yet reviewed). The order gains `estimate` (`{ earliestDate, latestDate }` counted
from the day it was placed, or `null` for pickup) and `rider` (`{ name, phone, carrier, trackingReference }`, only while
`out_for_delivery`). `GET /checkout/{id}/status` gains `deliveryMethod`, `estimate`, `itemCount` and
`recipientFirstName`, and still no address or contact details.

**Admin.** `PUT /admin/products/{id}/variants` accepts up to **2,000** variants (4 MB body) and saves them set-based; the
audit record keeps a count and the first 50 changes. `GET /admin/orders` rows add `items` (up to three lines with
`title`, `quantity`, `image`). `POST /admin/orders/{id}/cancel` (`{ reason, restock? }`, `orders:cancel`: owner and
manager) cancels an order that is `pending_payment`, `placed` or `packed`: an unpaid order releases its stock hold,
promotion slots and open payment attempt; a paid one is restocked unless `restock: false`, keeps `paymentStatus: paid`,
and is then refunded through the refund endpoint. `PATCH /admin/orders/{id}/delivery` (`carrier`, `riderName`,
`riderPhoneE164`, `trackingReference`, `estimatedDeliveryAt`; blanks clear a field; refused once the order is closed) is
how a rider is assigned; moving to `out_for_delivery` does not require one. `GET /admin/customers/segments` returns
`{ everyone, segments: [{ key, label, rule, count }] }` for `vip` (5+ paid orders or ₦1,000,000), `new` (first paid order
in the last 30 days), `returning` (2+) and `lapsed` (no order in 120 days). `GET /admin/customers` accepts `segment` and
tags every row with its `segments`.

## Product card "was" price

Listing cards carry `price.compareAtMinor`: the struck-through compare-at price of the **cheapest** active variant when
that variant is on sale, otherwise `null` (so the card's "From ₦X" and its "was" always describe the same variant).

## Admin review queue

`GET /admin/reviews` rows carry `customerEmail` (masked, e.g. `a•••@example.com`) beside `customerPhone`, since customers
are email-first now. The **first page** (no `cursor`) also carries `page.total`: the number of reviews matching the
filter, which the admin nav uses as the "pending reviews" badge (`?status=pending&limit=1`). Later pages have `total: null`.

## Admin catalogue additions (product screens)

- `GET /admin/products`: the first page carries `summary` (`products`, `variants`, `lowStock`: not archived, live variants,
  products with a variant at or below its warning level) for the page header; later pages have `summary: null`. Rows carry
  `maxPriceMinor` beside `minPriceMinor`, for a price range on the card.
- `PUT /admin/products/{id}/variants`: option values accept a **negative** `priceDeltaMinor` (a closure costs less than a
  frontal) and `active` (false hides the value from shoppers while keeping it for staff; its variants should be sent inactive).
  `priceDeltaMinor` is a difference from the product's base price kept for the editor; what a customer pays is each
  variant's own `priceMinor`.

## Admin order screens

- `GET /admin/orders`: `status` accepts several statuses joined with commas (`placed,packed`), and `method` (`card` or
  `bank_transfer`) filters by how the order was paid. The first page (no `cursor`) carries `counts`, the number of orders in
  each status under the *other* filters, for the filter pills; later pages have `counts: null`. Rows add `area` (the delivery
  area, or the city) and `state`.
- `GET /admin/orders/{id}`: `customer` gains `paidOrders` and `lifetimeValueMinor` (paid and refunded orders, matched by
  account, or by phone number for guests), items gain `image` (`{ objectKey, url }` or `null`), and `allowedTransitions` is
  empty for an unpaid order. The status and cancel endpoints return the same shape.

## Dashboard additions

`GET /admin/dashboard` also returns, for the current period:

- `funnel`: distinct sessions that reached each step (`sessions`, `viewedProduct`, `addedToBag`, `checkout`) and `purchased`
  (paid orders), or `null` when no browsing events were recorded.
- `customers`: `newBuyers` (their first paid order was in the period), `returningBuyers` (they had paid before; guests are
  recognised by phone number) and `topStates` (up to three: `state`, `orders`, `sharePct` of paid orders).
- `campaigns`: up to four live promotions with `orders` and `revenueMinor` (paid orders they were used on in the period),
  `viaCode`, `kind` and `endsAt`.
- `topProducts` (here and on `/admin/analytics/products`) gain `image` (`{ objectKey, url }` or `null`), `availableQuantity`
  and `lowStock`.

## Payout account (Paystack subaccount)

Sales settle to a Paystack **subaccount**. Connecting it is an owner action; until one is connected, sales go to the main
Paystack account as before.

- `GET /admin/payouts/account` (`settings:read`): `{ configured: false, mode }` or `{ configured: true, mode, subaccountCode,
  businessName, bankCode, bankName, accountName, accountLast4, updatedAt }`. `mode` is `live` for an `sk_live_` key, else `test`.
  The full account number is never stored or returned; Paystack holds it.
- `GET /admin/payouts/banks` (`settings:write`): `{ data: [{ name, code }] }`, Nigerian banks from Paystack, cached for a day.
- `POST /admin/payouts/resolve` (`settings:write`) `{ bankCode, accountNumber }` returns `{ accountName }` from Paystack's
  account lookup (`422 ACCOUNT_NOT_FOUND` when there is no such account). The screens show it so the owner can check it.
- `PUT /admin/payouts/account` (`settings:write`) `{ businessName, bankCode, accountNumber }` looks the account up again (the
  name Paystack returns is the one kept), then creates the subaccount, or updates the existing one so its code never changes.
  Errors: `422 UNKNOWN_BANK`, `422 ACCOUNT_NOT_FOUND`, `422 PAYOUT_REJECTED` (with Paystack's reason), `503 PAYSTACK_UNAVAILABLE`.
  Paystack is called first and our record written after, in the same transaction as its audit entry (last four digits only).
- Checkout then passes `subaccount` and `bearer` to Paystack's Initialize Transaction. The stored share the main account keeps
  (`percentageCharge`) is 0 and the fee bearer is `subaccount`; neither has a screen. Confirm both with whoever owns the
  Paystack account before going live. A failure after Paystack creates the subaccount but before our record is saved leaves
  an unused subaccount at Paystack; connecting again creates a new one.
