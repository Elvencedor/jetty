"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, EmptyState, Media, Skeleton } from "@/components/ui";
import { biggestDrop, campaignTag, deltaOf, formatPct, funnelSteps, type Delta } from "@/lib/admin/dashboard";
import type { Compared, DashboardData } from "@/lib/api/admin-dashboard";
import { cn } from "@/lib/cn";
import { formatDate, formatNaira, formatNairaCompact } from "@/lib/format";

const CARD = "flex min-w-0 flex-col gap-3 rounded-[24px] border border-line bg-surface p-[18px]";
const H2 = "font-display text-heading-xs font-extrabold";

/** A card whose data failed to load says so and can try again, without disturbing the others. */
function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
      <span>We couldn&apos;t load {what}.</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

type State = { data: DashboardData | undefined; error: boolean; onRetry: () => void; stale: boolean };

const DELTA_TONE: Record<Delta["tone"], string> = { up: "bg-success-bg text-success", down: "bg-danger-bg text-danger", flat: "bg-neutral-bg text-muted" };

function DeltaPill({ delta, label }: { delta: Delta | null; label: string }) {
  if (!delta) return null;
  return (
    <span className={cn("rounded-[12px] px-2.5 py-1 text-label font-bold", DELTA_TONE[delta.tone])}>
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{label} {delta.spoken}</span>
    </span>
  );
}

function Kpi({ label, value, delta }: { label: string; value: ReactNode; delta: Delta | null }) {
  return (
    <div className="flex items-center justify-between rounded-[22px] border border-line bg-surface px-[18px] py-4">
      <div className="flex flex-col">
        <span className="text-muted">{label}</span>
        <span className="font-display text-heading-md font-extrabold">{value}</span>
      </div>
      <DeltaPill delta={delta} label={label} />
    </div>
  );
}

/** Orders, average order value and conversion for the period, each with its change. */
export function KpiStack({ data, error, onRetry, stale }: State) {
  const k = data?.kpis;
  const conversion = (c: Compared) => (c.current === null ? "No data yet" : formatPct(c.current));
  return (
    <div className={cn("flex min-w-0 flex-[1_1_280px] flex-col gap-3.5", stale && "opacity-70")}>
      {error ? <Failed what="the figures" onRetry={onRetry} /> : !k ? (
        Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[84px] rounded-[22px]" />)
      ) : (
        <>
          <Kpi label="Orders" value={k.orders.current} delta={deltaOf(k.orders)} />
          <Kpi label="Avg. order value" value={formatNaira(k.averageOrderValueMinor.current ?? 0)} delta={deltaOf(k.averageOrderValueMinor)} />
          <Kpi label="Conversion" value={conversion(k.conversionRatePct)} delta={deltaOf(k.conversionRatePct, "pts")} />
        </>
      )}
    </div>
  );
}

const PIPELINE = [
  { key: "toPack", label: "To pack", status: "pack", tone: "bg-primary text-on-primary" },
  { key: "outForDelivery", label: "Out for delivery", status: "out", tone: "bg-surface-tint text-ink" },
  { key: "awaitingTransfer", label: "Awaiting transfer", status: "awaiting", tone: "bg-surface-tint text-ink" },
  { key: "paymentExceptions", label: "Payment exceptions", status: "closed", tone: "bg-surface-inverse text-on-inverse" },
] as const;

export function OrdersToAction({ data, error, onRetry, canOpen }: State & { canOpen: boolean }) {
  return (
    <section aria-label="Orders to action" className={CARD}>
      <div className="flex items-center justify-between"><h2 className={H2}>Orders to action</h2>{canOpen ? <Link href="/admin/orders" className="font-bold text-primary-strong">Open</Link> : null}</div>
      {error ? <Failed what="orders" onRetry={onRetry} /> : (
        <div className="grid grid-cols-2 gap-2">
          {PIPELINE.map((p) => {
            const tile = (
              <>
                {data ? <span className="font-display text-display-md font-extrabold leading-none">{data.actionCounts[p.key]}</span> : <Skeleton className="h-9 w-10" />}
                <span className="font-semibold">{p.label}</span>
              </>
            );
            const cls = cn("flex flex-col gap-1 rounded-[18px] p-3.5", p.tone);
            return canOpen ? <Link key={p.key} href={`/admin/orders?status=${p.status}`} className={cls}>{tile}</Link> : <div key={p.key} className={cls}>{tile}</div>;
          })}
        </div>
      )}
    </section>
  );
}

export function LiveCampaigns({ data, error, onRetry, canManage }: State & { canManage: boolean }) {
  return (
    <section aria-label="Live campaigns" className={CARD}>
      <div className="flex items-center justify-between"><h2 className={H2}>Live campaigns</h2>{canManage ? <Link href="/admin/promotions" className="font-bold text-primary-strong">Manage</Link> : null}</div>
      {error ? <Failed what="campaigns" onRetry={onRetry} /> : !data ? <Skeleton className="h-40" /> : data.campaigns.length === 0 ? (
        <p className="text-muted">Nothing is running right now.</p>
      ) : (
        <ul>
          {data.campaigns.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2.5 border-b border-line-soft py-2 last:border-0">
              <span aria-hidden="true" className={cn("flex size-[38px] shrink-0 items-center justify-center rounded-[12px] text-micro font-extrabold", i === 0 ? "bg-primary text-on-primary" : i === 1 ? "bg-surface-inverse text-on-inverse" : "bg-surface-tint text-primary-strong")}>{campaignTag(c.kind, c.viaCode)}</span>
              <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                <span className="truncate font-bold">{c.name}</span>
                <span className="text-caption text-muted">{c.viaCode ? "Code" : "Automatic"} · {c.endsAt ? `ends ${formatDate(c.endsAt)}` : "always on"}</span>
              </span>
              <span className="flex flex-col items-end leading-[1.3]"><span className="font-extrabold">{formatNairaCompact(c.revenueMinor)}</span><span className="text-caption text-muted">{c.orders} {c.orders === 1 ? "order" : "orders"}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Funnel({ data, error, onRetry }: State) {
  const steps = data?.funnel ? funnelSteps(data.funnel) : null;
  const drop = steps ? biggestDrop(steps) : null;
  return (
    <section aria-label="Where shoppers drop off" className={CARD}>
      <h2 className={H2}>Where shoppers drop off</h2>
      {error ? <Failed what="the funnel" onRetry={onRetry} /> : !data ? <Skeleton className="h-40" /> : !steps ? (
        <p className="text-muted">No visits recorded in this period yet.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2.5">
            {steps.map((s) => (
              <li key={s.label} className="grid grid-cols-[112px_minmax(0,1fr)_54px] items-center gap-2 text-body-sm">
                <span>{s.label}</span>
                <span aria-hidden="true" className="h-3.5 rounded-[7px] bg-surface-blush"><span className="block h-full rounded-[7px] bg-primary" style={{ width: `${Math.max(s.pctOfSessions, s.count > 0 ? 2 : 0)}%` }} /></span>
                <span className="text-right font-semibold">{s.count.toLocaleString("en-NG")}<span className="sr-only"> ({s.pctOfSessions}% of sessions)</span></span>
              </li>
            ))}
          </ol>
          {drop ? <p className="rounded-[14px] bg-surface-tint px-3 py-2.5 text-body-sm">Biggest drop is <strong>{drop.from} → {drop.to}</strong>: {drop.lostPct}% of shoppers don&apos;t go on.</p> : null}
        </>
      )}
    </section>
  );
}

export function BestSellers({ data, error, onRetry, canOpen }: State & { canOpen: boolean }) {
  return (
    <section aria-label="Best sellers" className={cn(CARD, "flex-[2_1_560px]")}>
      <div className="flex items-center justify-between"><h2 className={H2}>Best sellers</h2>{canOpen ? <Link href="/admin/products" className="font-bold text-primary-strong">All products</Link> : null}</div>
      {error ? <Failed what="best sellers" onRetry={onRetry} /> : !data ? <Skeleton className="h-48" /> : data.topProducts.length === 0 ? (
        <EmptyState title="No sales yet in this period">Your best sellers will show here.</EmptyState>
      ) : (
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-2.5">
          {data.topProducts.map((t, i) => (
            <li key={t.productId ?? t.title} className="flex flex-col gap-1.5">
              <div className="relative">
                <Media image={t.image} alt="" aspect="1 / 1" tone={i} sizes="200px" className="rounded-[18px]" />
                <span className="absolute left-2 top-2 flex size-[26px] items-center justify-center rounded-full bg-surface-inverse text-caption font-extrabold text-on-inverse"><span className="sr-only">Number </span>{i + 1}</span>
                {t.lowStock ? <span className="absolute bottom-2 left-2 rounded-pill bg-danger-bg px-2 py-0.5 text-caption font-bold text-danger">Low · {t.availableQuantity} left</span> : null}
              </div>
              <span className="font-bold leading-[1.3]">{t.title}</span>
              <span className="text-body-sm text-muted">{t.units} sold · {formatNairaCompact(t.revenueMinor)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CustomersCard({ data, error, onRetry, pendingReviews, canModerate }: State & { pendingReviews: number | undefined; canModerate: boolean }) {
  const c = data?.customers;
  const total = c ? c.newBuyers + c.returningBuyers : 0;
  const newShare = total ? Math.round((c!.newBuyers / total) * 100) : 0;
  return (
    <section aria-label="Customers" className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5 rounded-[24px] bg-surface-inverse p-[18px] text-on-inverse">
      <h2 className={H2}>Customers</h2>
      {error ? <Failed what="customers" onRetry={onRetry} /> : !c ? <Skeleton className="h-40 bg-white/10" /> : total === 0 ? (
        <p className="text-on-inverse-muted">No buyers in this period yet.</p>
      ) : (
        <>
          <div className="flex gap-3.5">
            <span className="flex flex-col"><span className="font-display text-heading-lg font-extrabold">{c.newBuyers}</span><span className="text-on-inverse-muted">New</span></span>
            <span className="flex flex-col"><span className="font-display text-heading-lg font-extrabold">{c.returningBuyers}</span><span className="text-on-inverse-muted">Returning</span></span>
          </div>
          <span aria-hidden="true" className="flex h-3.5 overflow-hidden rounded-[7px]"><span className="bg-primary" style={{ width: `${newShare}%` }} /><span className="bg-pink-350" style={{ width: `${100 - newShare}%` }} /></span>
          {c.topStates.length ? (
            <div className="flex flex-col gap-1.5 text-body-sm">
              <h3 className="font-bold">Top states</h3>
              {c.topStates.map((s) => <span key={s.state} className="flex justify-between"><span>{s.state}</span><span>{s.sharePct}%</span></span>)}
            </div>
          ) : null}
        </>
      )}
      {canModerate && pendingReviews ? (
        <p className="rounded-[14px] bg-surface-inverse-raised px-3 py-2.5 text-body-sm">{pendingReviews} {pendingReviews === 1 ? "review is" : "reviews are"} waiting for approval. <Link href="/admin/reviews" className="font-bold text-on-inverse-muted underline">Moderate</Link></p>
      ) : null}
    </section>
  );
}
