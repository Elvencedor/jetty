"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { Skeleton } from "@/components/ui";
import { adminKeys } from "@/lib/admin/keys";
import { permits } from "@/lib/admin/permissions";
import { getOrdersToAction, getPendingReviewCount } from "@/lib/api/admin";
import { useAdminSession } from "@/lib/stores/session";

const TILES = [
  { key: "toPack", label: "To pack" },
  { key: "toDispatch", label: "To dispatch" },
  { key: "awaitingTransfer", label: "Awaiting transfer" },
  { key: "paymentExceptions", label: "Payment exceptions" },
] as const;

/** The landing page. For now it shows what is waiting on someone; the full dashboard arrives with the next phase. */
export function Overview() {
  const admin = useAdminSession((s) => s.user);
  const held = admin?.permissions ?? [];
  const orders = useQuery({ queryKey: adminKeys.ordersToAction, queryFn: ({ signal }) => getOrdersToAction({ signal }), enabled: permits(held, "orders:read") });
  const reviews = useQuery({ queryKey: [...adminKeys.badges, "reviews"], queryFn: ({ signal }) => getPendingReviewCount({ signal }), enabled: permits(held, "reviews:moderate") });
  const name = admin?.email.split("@")[0] ?? "";

  return (
    <>
      <PageHeader title={`Hello, ${name}`} subtitle="Here is what is waiting on you." />
      {permits(held, "orders:read") ? (
        <section aria-label="Orders to action" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <div className="flex items-center justify-between"><h2 className="font-display text-heading-xs font-extrabold">Orders to action</h2><Link href="/admin/orders" className="font-bold text-primary-strong">Open</Link></div>
          {orders.isError ? <p role="alert" className="text-danger">We couldn&apos;t load this. <button type="button" onClick={() => orders.refetch()} className="font-semibold underline">Retry</button></p> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {TILES.map((t) => (
                <Link key={t.key} href="/admin/orders" className="flex flex-col rounded-lg bg-surface-tint p-3.5">
                  {orders.data ? <span className="font-display text-[30px] font-extrabold leading-none">{orders.data[t.key]}</span> : <Skeleton className="h-8 w-10" />}
                  <span className="font-semibold">{t.label}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
      {permits(held, "reviews:moderate") ? (
        <section aria-label="Reviews" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-5">
          <div><h2 className="font-display text-heading-xs font-extrabold">Reviews to moderate</h2><p className="text-muted">New reviews stay hidden until someone approves them.</p></div>
          <Link href="/admin/reviews" className="rounded-pill bg-surface-tint px-4 py-2 font-bold text-primary-strong">{reviews.data === undefined ? "…" : reviews.data} waiting</Link>
        </section>
      ) : null}
    </>
  );
}
