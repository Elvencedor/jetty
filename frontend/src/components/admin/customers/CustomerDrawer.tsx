"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SideDrawer } from "../SideDrawer";
import { Button, Skeleton, StatusPill } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { averageOrder, avatarTone, displayName, initials, monthYear, PHOTO_BG, placeOf } from "@/lib/admin/customers";
import { whatsappLink } from "@/lib/admin/orders";
import { getAdminCustomer } from "@/lib/api/admin-customers";
import { cn } from "@/lib/cn";
import { formatNaira, formatNairaCompact, formatPhone, formatRelativeOrAbsolute } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { useAdminSession } from "@/lib/stores/session";
import { permits } from "@/lib/admin/permissions";

const SECTION = "flex flex-col gap-2 border-b border-line-soft px-[18px] py-4";

/** A customer's profile: who they are, what they have spent, how to reach them, and their latest orders. */
export function CustomerDrawer({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const query = useQuery({ queryKey: adminKeys.detail("customers", customerId), queryFn: ({ signal }) => getAdminCustomer(customerId, { signal }), staleTime: 0 });
  const d = query.data;

  if (!d) {
    return (
      <SideDrawer open onClose={onClose} title="Customer profile" compactTitle>
        {query.isError ? (
          <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger">
            <span>{adminErrorMessage(query.error)}</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-32" /></div>
        )}
      </SideDrawer>
    );
  }

  const c = d.customer;
  const who = { name: d.lastOrder?.name ?? null, email: c.email, phone: c.phone };
  const place = d.lastOrder ? placeOf(d.lastOrder) : "";
  const canSeeOrders = permits(held, "orders:read");

  return (
    <SideDrawer open onClose={onClose} title="Customer profile" compactTitle>
      <div className="flex items-center gap-3.5 border-b border-line-soft p-[18px]">
        <span aria-hidden="true" className={cn("flex size-[60px] shrink-0 items-center justify-center rounded-full text-heading-xs font-extrabold text-primary-deep", PHOTO_BG[avatarTone(c.id)])}>{initials(who)}</span>
        <div className="flex min-w-0 flex-1 flex-col leading-[1.3]">
          <h3 className="truncate font-display text-heading-sm font-extrabold">{displayName(who)}</h3>
          <span className="text-body-sm text-muted">Customer since {monthYear(c.createdAt)}{place ? ` · ${place}` : ""}</span>
          {c.status !== "active" ? <span className="mt-1 self-start"><StatusPill tone="warning">{c.status === "disabled" ? "Account disabled" : "Not verified yet"}</StatusPill></span> : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-line-soft px-[18px] py-4">
        {[["Orders", String(d.orderCount)], ["Spent", formatNairaCompact(d.lifetimeValueMinor)], ["Avg order", formatNairaCompact(averageOrder(d.orderCount, d.lifetimeValueMinor))]].map(([label, value]) => (
          <div key={label} className="flex flex-col rounded-[16px] bg-surface-tint p-2.5"><span className="text-caption text-muted">{label}</span><span className="font-display text-heading-xs font-extrabold">{value}</span></div>
        ))}
      </div>

      <section aria-label="Contact" className={SECTION}>
        <h3 className="font-extrabold">Contact</h3>
        <p className="text-body-sm">{[c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(" · ") || "No contact details"}</p>
        {d.lastOrder?.addressLine ? <p className="text-body-sm text-ink-soft">{[d.lastOrder.addressLine, place].filter(Boolean).join(", ")}</p> : null}
        {c.phone ? <Button href={whatsappLink(c.phone)} target="_blank" rel="noopener noreferrer" variant="dark" size="sm" className="mt-1 self-start">WhatsApp</Button> : null}
      </section>

      <section aria-label="Recent orders" className={cn(SECTION, "border-b-0")}>
        <div className="flex items-center justify-between"><h3 className="font-extrabold">Recent orders</h3>{canSeeOrders && (c.phone || c.email) ? <Link href={`/admin/orders?q=${encodeURIComponent(c.phone ?? c.email ?? "")}`} className="text-body-sm font-bold text-primary-strong">All orders</Link> : null}</div>
        {d.recentOrders.length === 0 ? <p className="text-body-sm text-muted">No orders yet.</p> : (
          <ul className="flex flex-col gap-1.5">
            {d.recentOrders.slice(0, 5).map((o) => {
              const row = (
                <>
                  <span className="flex flex-col leading-[1.3]"><span className="font-bold">#{o.orderNumber}</span><span className="text-caption text-muted">{formatRelativeOrAbsolute(o.createdAt)}</span></span>
                  <span className="flex items-center gap-2"><StatusPill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusPill><span className="font-bold">{formatNaira(o.totalMinor)}</span></span>
                </>
              );
              const cls = "flex items-center justify-between gap-2 rounded-[12px] bg-surface-subtle px-2.5 py-2 text-body-sm";
              return <li key={o.id}>{canSeeOrders ? <Link href={`/admin/orders?order=${o.id}`} className={cls}>{row}</Link> : <div className={cls}>{row}</div>}</li>;
            })}
          </ul>
        )}
      </section>
    </SideDrawer>
  );
}
