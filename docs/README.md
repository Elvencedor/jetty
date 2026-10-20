# Jetty's Hair — Engineering documentation

This documentation turns the feature inventory into an implementation-ready
reference design. The feature inventory remains the product source of truth;
the other documents define a consistent proposed database, API, and deployment.

## Documents

| Document | Use it to |
|---|---|
| [Feature inventory](./FEATURES.md) | Confirm feature scope, priority, and stable feature IDs |
| [Database schema](./DATABASE.md) | Implement PostgreSQL tables, constraints, indexes, and migrations |
| [API contract](./API.md) | Implement storefront, customer, and admin HTTP interfaces |
| [Infrastructure](./INFRASTRUCTURE.md) | Provision environments, deploy services, and operate production |
| [Frontend plan](./FRONTEND.md) | Sequence the storefront and admin build, see which API changes it needs, and track feature coverage |

## Decisions shared by all documents

1. **P0 is the launch contract.** P1 and P2 endpoints, tables, and services
   are explicitly marked; they must not be launch blockers unless a P0 flow
   depends on them.
2. **PostgreSQL is authoritative** for catalog, prices, promotions, stock,
   customers, orders, payment attempts, and the durable transactional outbox.
   The client owns the cart; the API validates its contents at quote and
   checkout time. No server-side cart store is required.
3. **All API paths are rooted at `/api/v1`.** Amounts are integer minor units
   (`NGN` kobo); timestamps are UTC ISO 8601. The storefront formats Naira.
4. **The server calculates every price.** Product, cart, checkout, and payment
   totals use one pricing implementation and a persisted quote snapshot.
5. **Paystack is the launch payment provider.** The API initializes and
   verifies transactions; the browser receives only the public checkout
   action/access code. Signed webhooks and server-side verification are
   idempotent; card numbers and CVVs are never stored.
6. **Checkout persists a pending order before payment.** The order snapshot,
   Paystack reference, payment attempt, and stock reservation support retries
   and webhook reconciliation. Only verified payment moves the order to
   `placed`; failed/expired attempts do not count as sales.
7. **Infrastructure is a proposed Vercel + Railway deployment**, not a claim
   that the repository already uses those providers. Confirm service
   availability, data residency, and operational ownership before provisioning.

## Delivery slices

### Launch (P0)

- Catalog, collections, variants, inventory, search/filter, reviews, content,
  cart, coupons/promotions, delivery quotes, checkout, card/bank-transfer
  payments, orders/tracking, admin catalog/orders/promotions, core analytics,
  transactional email, and operational controls.
- Implement the P0 schema and endpoint sections in [DATABASE.md](./DATABASE.md)
  and [API.md](./API.md).
- Deploy the P0 topology in [INFRASTRUCTURE.md](./INFRASTRUCTURE.md).

### Post-launch (P1)

- Saved addresses/payment methods, wishlist, media reviews, WhatsApp/SMS,
  returns/refunds, roles, audit log, rider assignment, advanced promotion
  reporting, and additional analytics/content controls.

### Later (P2)

- Social login, bundles, wishlist alerts, installment payments, live map,
  advanced promotion tooling, and other P2 items in the feature inventory.

## Change control

When behavior changes, update the feature ID mapping and all affected contracts
in the same change. Add a migration for persisted data changes, preserve
backward compatibility within `/api/v1`, and record any breaking contract as a
versioned API change.
