"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "../PageHeader";
import { Button, EmptyState, Skeleton, StatusPill, Switch } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { calendarRows, daysInMonth, KIND_LABEL, summaryText } from "@/lib/admin/promotions";
import { permits } from "@/lib/admin/permissions";
import { listAdminPromotions, setPromotionActive, type PromotionRow, type PromotionStatus } from "@/lib/api/admin-promotions";
import { cn } from "@/lib/cn";
import { formatDate, lagosDateKey } from "@/lib/format";
import { PROMOTION_STATUS } from "@/lib/status";
import { useAdminSession } from "@/lib/stores/session";
import { toast } from "@/lib/stores/toast";

const BAR: Record<PromotionStatus, string> = { live: "bg-primary text-on-primary", scheduled: "bg-surface-blush text-primary-strong", ended: "bg-neutral-bg text-muted", draft: "bg-surface-tint text-primary-strong", inactive: "bg-neutral-bg text-muted" };

/** What is running and when: a month calendar, then every promotion with a switch. Building and editing happen on their own pages. */
export function PromotionsPage() {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canWrite = permits(held, "promotions:write");
  const queryClient = useQueryClient();
  const key = adminKeys.list("promotions", { all: true });
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => listAdminPromotions({ limit: 100 }, { signal }), staleTime: 0 });
  const [now] = useState(() => new Date());
  const today = lagosDateKey(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const todayNumber = Number(today.slice(8, 10));
  const days = daysInMonth(year, month);
  const rows = list.data?.data;
  const calendar = rows ? calendarRows(rows, year, month) : [];

  const toggle = useMutation({
    mutationFn: ({ row, on }: { row: PromotionRow; on: boolean }) => setPromotionActive(row.id, on),
    onSuccess: (_d, { row, on }) => {
      toast.success(on ? `${row.name} switched on` : `${row.name} switched off`);
      void queryClient.invalidateQueries({ queryKey: adminKeys.resource("promotions") });
    },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  return (
    <>
      <PageHeader
        title="Promotions & storefront"
        subtitle={rows ? summaryText(rows) : " "}
        actions={canWrite ? <Button href="/admin/promotions/new" iconLeft={<Plus aria-hidden="true" size={16} />}>New promotion</Button> : null}
      />

      <section aria-label="Campaign calendar" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-[18px]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-heading-xs font-extrabold">{new Date(`${year}-${String(month).padStart(2, "0")}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} calendar</h2>
          <span className="text-caption text-muted">Today is highlighted</span>
        </div>
        {list.isError && !rows ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger"><span>{adminErrorMessage(list.error)}</span><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></div>
        ) : !rows ? <Skeleton className="h-40" /> : calendar.length === 0 ? (
          <p className="text-muted">Nothing is scheduled this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-[760px] flex-col gap-2">
              <div aria-hidden="true" className="grid text-micro text-muted" style={{ gridTemplateColumns: `200px repeat(${days}, minmax(0, 1fr))` }}>
                <span />
                {Array.from({ length: days }, (_, i) => <span key={i} className={cn("text-center", i + 1 === todayNumber && "rounded-full bg-primary font-bold text-on-primary")}>{i + 1}</span>)}
              </div>
              {calendar.map((c) => (
                <div key={c.id} className="grid items-center" style={{ gridTemplateColumns: `200px repeat(${days}, minmax(0, 1fr))` }}>
                  <span className="flex flex-col pr-2.5 leading-[1.25]"><span className="truncate text-body-sm font-bold">{c.name}</span><span className="text-micro text-muted">{KIND_LABEL[c.kind]}</span></span>
                  <Link href={`/admin/promotions/${c.id}`} className={cn("flex h-[30px] items-center overflow-hidden whitespace-nowrap rounded-full px-2.5 text-micro font-bold", BAR[c.status])} style={{ gridColumn: `${c.from + 1} / ${c.to + 2}` }}>
                    {c.label}<span className="sr-only"> promotion {c.name}, {PROMOTION_STATUS[c.status]?.label}, open</span>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-label="All promotions" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-[18px]">
        <h2 className="font-display text-heading-xs font-extrabold">All promotions</h2>
        {!rows ? <Skeleton className="h-32" /> : rows.length === 0 ? (
          <EmptyState title="No promotions yet" action={canWrite ? <Button href="/admin/promotions/new">New promotion</Button> : undefined}>Create a discount, a code or free delivery to get started.</EmptyState>
        ) : (
          <ul>
            {rows.map((r) => {
              const pill = PROMOTION_STATUS[r.status] ?? PROMOTION_STATUS.draft!;
              const on = r.status === "live" || r.status === "scheduled";
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3 last:border-0">
                  <span className="flex min-w-0 flex-[1_1_220px] flex-col leading-[1.3]">
                    <Link href={`/admin/promotions/${r.id}`} className="truncate font-bold text-ink underline-offset-2 hover:underline">{r.name}</Link>
                    <span className="text-caption text-muted">{KIND_LABEL[r.kind]} · {r.type === "code" ? "With a code" : "Automatic"} · {r.startsAt ? formatDate(r.startsAt) : "Starts when switched on"}{r.endsAt ? ` to ${formatDate(r.endsAt)}` : ""}</span>
                  </span>
                  <span className="text-body-sm text-muted">{r.usage.redemptions} {r.usage.redemptions === 1 ? "use" : "uses"}{r.usage.limit ? ` of ${r.usage.limit}` : ""}</span>
                  <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                  {canWrite && r.status !== "ended" ? <Switch checked={on} label={`${on ? "Switch off" : "Switch on"} ${r.name}`} disabled={toggle.isPending} onChange={(v) => toggle.mutate({ row: r, on: v })} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Homepage slots" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-[18px]">
        <div><h2 className="font-display text-heading-xs font-extrabold">Homepage slots</h2><p className="text-body-sm text-muted">Banners, announcements and featured rows are arranged in the storefront editor.</p></div>
        <Button href="/admin/storefront" variant="outline">Open storefront editor</Button>
      </section>
    </>
  );
}
