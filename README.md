# jetty

A monorepo for an e-commerce platform for ordering beauty products.

## Workspaces

| Workspace | Package | Stack | Local URL |
|---|---|---|---|
| [frontend/](./frontend) | `@jetty/frontend` | Next.js 16 (App Router, TypeScript, Tailwind CSS 4) | http://localhost:3000 |
| [api/](./api) | `@jetty/api` | hapi 21 (TypeScript, Joi) | http://localhost:4000 |

Dependencies are managed with npm workspaces from a single root lockfile.
`packages/*` is already a workspace root, so shared libraries can be added
without changing the setup.

## Requirements

- Node.js >= 22.18 (the API uses `--env-file-if-exists`)
- npm >= 10

## Getting started

```bash
npm install

cp api/.env.example api/.env
cp frontend/.env.example frontend/.env.local

npm run dev
```

`npm run dev` starts both apps together with prefixed, colour-coded output.

## Scripts

Run from the repository root:

| Script | Does |
|---|---|
| `npm run dev` | Start the API and storefront together |
| `npm run dev:api` / `npm run dev:web` | Start one app |
| `npm run build` | Build both apps |
| `npm run typecheck` | TypeScript check across workspaces |
| `npm run lint` | Lint across workspaces |
| `npm test` | Run tests across workspaces |
| `npm run check` | Typecheck, then lint, then test |
| `npm run clean` | Remove installed and built output |

Target one workspace directly with `npm run <script> --workspace @jetty/api`.

## How the apps fit together

The storefront never talks to PostgreSQL. It calls the API over HTTP using
`apiFetch` in [frontend/src/lib/api.ts](./frontend/src/lib/api.ts), which
understands the response and error envelopes in
[docs/API.md](./docs/API.md). The API owns pricing, stock, orders and
payments, and is the only service that holds the Paystack secret key.

All versioned endpoints are mounted under `/api/v1` in
[api/src/server.ts](./api/src/server.ts). `/healthz` and `/readyz` sit outside
that prefix so platform health checks do not depend on the versioned contract.

## Project documentation

- [Documentation index](./docs/README.md)
- [Feature inventory and launch scope](./docs/FEATURES.md)
- [Database schema proposal](./docs/DATABASE.md)
- [API contract proposal](./docs/API.md)
- [Infrastructure proposal](./docs/INFRASTRUCTURE.md)

## Deployment

[docs/INFRASTRUCTURE.md](./docs/INFRASTRUCTURE.md) proposes Vercel for the
storefront and Railway for the API, worker and PostgreSQL. Nothing is
provisioned yet. When connecting providers, set the Vercel project root to
`frontend/` and the Railway service root to `api/`.
