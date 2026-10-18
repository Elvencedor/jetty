# @jetty/api

The hapi commerce API. Implements the contract in
[../docs/API.md](../docs/API.md) and is the authoritative writer for catalog,
pricing, stock, orders and payments.

## Run it

From the repository root (`npm install` first):

```bash
npm run dev:api     # tsx watch, reloads on change
```

Or from this directory:

```bash
cp .env.example .env
npm run dev
npm run build && npm start   # compiled
npm run db:migrate           # needs DATABASE_URL (PostgreSQL 16+)
npm run db:seed              # idempotent; set SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD for the first owner
npm test                     # integration tests skip unless TEST_DATABASE_URL (and TEST_REDIS_URL for rate limits) is set

docker compose up -d --wait  # disposable Postgres on :55432 and Redis on :56379 for integration tests
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres TEST_REDIS_URL=redis://localhost:56379 npm test
```

## Layout

```
src/
  index.ts                     entrypoint: env, server, signal handling
  server.ts                    server construction and route mounting
  config/env.ts                Joi-validated environment
  lib/errors.ts                error envelope and stable error codes
  lib/logger.ts                structured JSON logger
  plugins/request-context.ts   request IDs and per-request logging
  plugins/error-envelope.ts    renders every error as the documented shape
  routes/health.ts             /healthz and /readyz
  routes/v1/                   versioned endpoints (meta, catalog)
  modules/catalog/             product listing (keyset pagination) and detail queries
  modules/inventory/           stock reservation and expiry release
  modules/pricing/             server-side cart pricing and the promotion engine
  modules/delivery/            admin-configured delivery zones and methods
  modules/checkout/            atomic order + reservation + payment attempt creation
  modules/payments/            payment provider interface, Paystack client, settlement transaction
  modules/auth/                customer register, login, refresh rotation, logout
  worker/                      background worker: releases expired reservations and holds, cleans idempotency keys (npm run start:worker)
  webhook/                     standalone Paystack webhook server (own process: npm run start:webhook)
  db/                          Drizzle schema, client, migrate and seed
```

## Conventions

- **Versioning.** Routes in `routes/v1/` declare paths relative to the root;
  `server.ts` applies the `/api/v1` prefix once. Health probes are registered
  unprefixed.
- **Errors.** Throw with the helpers in `lib/errors.ts` rather than returning
  error bodies. Every error leaves as
  `{ "error": { "code", "message", "requestId", "details" } }`. 5xx messages are
  replaced with a generic string, so stack traces and credentials cannot leak.
- **Validation.** Declare `options.validate` on each route with Joi. Failures
  are reported as `422 VALIDATION_FAILED`, per the contract.
- **Request IDs.** `request.app.requestId` is set for every request, honouring
  an inbound `x-request-id` so edge and platform traces line up. It is echoed
  on every response and included in error bodies.
- **Logging.** Use `request.app.logger` inside handlers so lines carry the
  request ID. Never log tokens, OTPs, card data or unnecessary PII.
- **Money.** Integer minor units (NGN kobo) with an explicit currency. The
  server calculates every total; client-supplied prices are never trusted.
- **Testing.** `createServer()` returns an unstarted server, so tests use
  `server.inject()` without binding a port. See `src/server.test.ts`.

## Environment

See [.env.example](./.env.example). `config/env.ts` validates on boot and the
process exits on invalid configuration rather than starting in a broken state.

## Not built yet

Phone/OTP and password-reset auth, admin auth, the transactional outbox processor and the remaining worker
jobs. `/readyz` reports the process only; add
dependency checks there as they are wired up.
