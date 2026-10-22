"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeader } from "../PageHeader";
import { BestSellers, CustomersCard, Funnel, KpiStack, LiveCampaigns, OrdersToAction } from "./Cards";
import { RevenueCard } from "./RevenueCard";
import { Button } from "@/components/ui";
import { adminKeys } from "@/lib/admin/keys";
import { daysIn, headline, intervalFor, phraseFor, RANGES, rangeBounds, rangeFromParams, todayLabel } from "@/lib/admin/dashboard";
import { permits } from "@/lib/admin/permissions";
import { useUrlState } from "@/lib/admin/useUrlState";
import { getPendingReviewCount } from "@/lib/api/admin";
import { getDashboard, getRevenueSeries } from "@/lib/api/admin-dashboard";
import { cn } from "@/lib/cn";
import { useAdminSession } from "@/lib/stores/session";

/** The landing page: how the shop is doing over a range kept in the address (`?range=7d|30d|quarter|custom&from=&to=`), and what needs doing. */
export function Dashboard() {
  const admin = useAdminSession((s) => s.user);
  const held = admin?.permissions ?? [];
  const router = useRouter();
  const pathname = usePathname();
  const [rangeParam, setRange] = useUrlState("range");
  const [fromParam] = useUrlState("from");
  const [toParam] = useUrlState("to");
  const choice = rangeFromParams(rangeParam, fromParam, toParam);
  const [picking, setPicking] = useState(choice.key === "custom");
  const [draft, setDraft] = useState({ from: choice.from ?? "", to: choice.to ?? "" });
  const [draftError, setDraftError] = useState<string>();

  // The range key carries the day; the instants are worked out when the request is made.
  const key = { range: choice.key, from: choice.from, to: choice.to };
  const dashboard = useQuery({
    queryKey: adminKeys.list("dashboard", key),
    queryFn: ({ signal }) => getDashboard(rangeBounds(choice), { signal }),
    placeholderData: (previous) => previous,
  });
  const revenue = useQuery({
    queryKey: adminKeys.list("dashboard-revenue", key),
    queryFn: ({ signal }) => getRevenueSeries(rangeBounds(choice), intervalFor(daysIn(choice)), { signal }),
    placeholderData: (previous) => previous,
  });
  const reviews = useQuery({ queryKey: [...adminKeys.badges, "reviews"], queryFn: ({ signal }) => getPendingReviewCount({ signal }), enabled: permits(held, "reviews:moderate") });

  const name = admin?.email.split("@")[0] ?? "";
  const stale = dashboard.isPlaceholderData || revenue.isPlaceholderData;
  const shared = { data: dashboard.data, error: dashboard.isError && !dashboard.data, onRetry: () => void dashboard.refetch(), stale };

  function applyCustom(e: FormEvent) {
    e.preventDefault();
    const next = rangeFromParams("custom", draft.from, draft.to);
    if (next.key !== "custom") return setDraftError("Pick a start and an end day, the start first, no more than a year apart");
    setDraftError(undefined);
    const query = new URLSearchParams(window.location.search);
    query.set("range", "custom");
    query.set("from", next.from!);
    query.set("to", next.to!);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        subtitle={`${todayLabel()}`}
        title={dashboard.data ? headline(name, dashboard.data.kpis.revenueMinor) : `Hey ${name}`}
        actions={
          <div role="group" aria-label="Range" className="flex rounded-pill border border-line bg-surface p-1">
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={choice.key === r.key} onClick={() => { setPicking(false); setRange(r.key === "30d" ? null : r.key); }} className={cn("h-[34px] rounded-pill px-3.5 font-semibold", choice.key === r.key ? "bg-primary text-on-primary" : "text-ink")}>{r.label}</button>
            ))}
            <button type="button" aria-pressed={choice.key === "custom"} aria-expanded={picking} onClick={() => setPicking((p) => !p)} className={cn("h-[34px] rounded-pill px-3.5 font-semibold", choice.key === "custom" ? "bg-primary text-on-primary" : "text-ink")}>Custom</button>
          </div>
        }
      />

      {picking ? (
        <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-3.5">
          <label className="flex flex-col gap-1 text-label font-semibold">From<input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
          <label className="flex flex-col gap-1 text-label font-semibold">To<input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
          <Button type="submit" variant="dark">Show these days</Button>
          {draftError ? <p role="alert" className="w-full text-caption font-medium text-danger">{draftError}</p> : null}
        </form>
      ) : null}

      <div className="flex flex-wrap gap-3.5">
        <RevenueCard revenue={dashboard.data?.kpis.revenueMinor} series={revenue.data} phrase={phraseFor(choice)} loading={dashboard.isPending} stale={stale} error={(revenue.isError && !revenue.data) || (dashboard.isError && !dashboard.data)} onRetry={() => { void dashboard.refetch(); void revenue.refetch(); }} />
        <KpiStack {...shared} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5">
        <OrdersToAction {...shared} canOpen={permits(held, "orders:read")} />
        <LiveCampaigns {...shared} canManage={permits(held, "promotions:read")} />
        <Funnel {...shared} />
      </div>

      <div className="flex flex-wrap gap-3.5">
        <BestSellers {...shared} canOpen={permits(held, "catalog:read")} />
        <CustomersCard {...shared} pendingReviews={reviews.data} canModerate={permits(held, "reviews:moderate")} />
      </div>
    </>
  );
}
