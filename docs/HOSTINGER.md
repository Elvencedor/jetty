# Deploying to Hostinger

Everything runs on one **Hostinger VPS (KVM)** with Docker Compose. Shared/"web" hosting cannot run this: the API,
Paystack webhook service, worker, PostgreSQL and Redis are long-running processes.

| Container | Role | Public? |
|---|---|---|
| `caddy` | TLS (automatic Let's Encrypt) and routing | 80/443 |
| `frontend` | Next.js storefront and `/admin` | via Caddy at `SITE_DOMAIN` |
| `api` | hapi API | via Caddy at `API_DOMAIN` |
| `webhook` | Paystack webhook service | via Caddy at `API_DOMAIN/webhooks/paystack` |
| `worker` | Outbox delivery and one-minute maintenance | no |
| `migrate` | Applies migrations on every `up`, then exits | no |
| `postgres`, `redis` | Data stores on the private network, no published ports | no |

Media stays on Cloudflare R2 (the VPS disk is not used for uploads). Files live in [deploy/](../deploy).

## One-time setup

1. **VPS.** Pick KVM 2 (2 vCPU / 8 GB) or larger: the Next build needs about 2 GB of RAM. Choose the Ubuntu 24.04
   with Docker template, or install Docker Engine and the compose plugin. Choose a data centre close to your customers.
2. **DNS.** Point A records for `SITE_DOMAIN` (e.g. `www.example.com`) and `API_DOMAIN` (e.g. `api.example.com`) at the
   VPS IP. Keep them on one registrable domain: the auth cookies are same-site only.
3. **Firewall.** In hPanel (or `ufw`) allow only 22, 80, 443 (TCP) and 443 (UDP). Do not open 5432 or 6379.
4. **Code and config.**
   ```sh
   git clone <repo> /opt/jetty && cd /opt/jetty/deploy
   cp .env.example .env && chmod 600 .env   # fill in every value
   ```
   Generate secrets with `openssl rand -hex 32` (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `AUTH_TOKEN_SECRET`,
   `REVALIDATE_SECRET`). Use hex so they are safe inside connection URLs.
5. **Start.** `docker compose up -d --build`. Migrations run automatically before the API, webhook and worker start.
6. **First admin.** `docker compose run --rm -e SEED_OWNER_EMAIL=you@example.com -e SEED_OWNER_PASSWORD='...' api node dist/db/seed.js`
7. **Paystack.** Set the webhook URL to `https://<API_DOMAIN>/webhooks/paystack` and use live keys in `.env`.
8. **Check.** `curl https://<API_DOMAIN>/readyz` returns `ready`; `docker compose ps` shows everything healthy.

If you put Cloudflare's proxy (orange cloud) in front, set `TRUSTED_PROXY_HOPS=2` so rate limits see real client IPs.

## Releasing

```sh
cd /opt/jetty && git pull && cd deploy && docker compose up -d --build
```

Migrations are applied by the `migrate` service on each deploy; use expand/migrate/contract for schema changes
([INFRASTRUCTURE.md](./INFRASTRUCTURE.md)). `NEXT_PUBLIC_*` values are baked in at build time, so changing
`API_DOMAIN`, `SITE_DOMAIN` or `MEDIA_HOST` needs `--build`. Roll back by checking out the previous commit and
re-running the same command. Logs: `docker compose logs -f api webhook worker`.

## Backups

`deploy/backup.sh` writes a gzipped `pg_dump` (14 days kept). Schedule it with cron and copy the files off the VPS,
and enable Hostinger's weekly VPS snapshots as well. A dump on the same disk does not survive losing the VPS. Test a
restore: `gunzip -c file.sql.gz | docker compose exec -T postgres psql -U jetty -d jetty`.

## Limits of this setup

- Single server: a reboot or `up --build` causes brief downtime, and there is no automatic failover.
- Point-in-time recovery is not available; the recovery point is the last backup (the 24 h target in INFRASTRUCTURE.md).
- Deploys are manual. CI (`.github/workflows/ci.yml`) only tests; add an SSH deploy job if you want push-to-deploy.
