"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { DataTable, type Column } from "../DataTable";
import { PageHeader } from "../PageHeader";
import { TablePager } from "../TablePager";
import { Dropdown, EmptyState, Media, StatusPill } from "@/components/ui";
import { useDebounced } from "@/components/shell/useDebounced";
import { adminKeys } from "@/lib/admin/keys";
import { DATE_RANGES, deliveryLine, ORDER_TABS, rangeStart, tabByKey, tabCount } from "@/lib/admin/orders";
import { ordersNeedingAction } from "@/lib/admin/nav";
import { pageRange, useCursorStack } from "@/lib/admin/useCursorStack";
import { useUrlState } from "@/lib/admin/useUrlState";
import { getOrdersToAction } from "@/lib/api/admin";
import { listAdminOrders, type AdminOrderRow, type PaymentMethod } from "@/lib/api/admin-orders";
import { cn } from "@/lib/cn";
import { formatNaira, formatPhone, formatRelativeOrAbsolute } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { OrderDrawer } from "./OrderDrawer";

const PAGE = 20;
const SELECT = "h-[42px] gap-2 rounded-pill border-[1.5px] border-line-strong bg-surface px-3 text-body-sm";

const COLUMNS: Column<AdminOrderRow>[] = [
  {
    key: "order",
    header: "Order",
    cell: (o) => (
      <span className="flex flex-col leading-[1.3]">
        <span className="font-bold">#{o.orderNumber}</span>
        <span className="text-caption font-normal text-muted">{formatRelativeOrAbsolute(o.placedAt ?? o.createdAt)}</span>
      </span>
    ),
  },
  { key: "customer", header: "Customer", cell: (o) => <span className="flex flex-col leading-[1.3]"><span>{o.recipientName ?? formatPhone(o.phone)}</span>{o.recipientName ? <span className="text-caption text-muted">{formatPhone(o.phone)}</span> : null}</span> },
  {
    key: "items",
    header: "Items",
    cell: (o) => (
      <span className="flex gap-[3px]" title={o.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}>
        {o.items.map((item, i) => <Media key={i} image={item.image} alt="" aspect="6 / 7" tone={i} sizes="24px" className="w-6 rounded-[6px]" />)}
        {o.itemCount > o.items.reduce((n, i) => n + i.quantity, 0) ? <span className="self-center pl-1 text-caption text-muted">+{o.itemCount - o.items.reduce((n, i) => n + i.quantity, 0)}</span> : null}
        <span className="sr-only">{o.itemCount} {o.itemCount === 1 ? "item" : "items"}</span>
      </span>
    ),
  },
  { key: "status", header: "Status", cell: (o) => <StatusPill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusPill> },
  { key: "delivery", header: "Delivery", cell: (o) => deliveryLine(o) },
  { key: "total", header: "Total", align: "right", className: "font-bold", cell: (o) => formatNaira(o.totalMinor) },
];

/** Orders for fulfilment staff: status pills with counts, a search, and one drawer (`?order=<id>`) per order. */
export function OrdersPage() {
  const [tabParam, setTab] = useUrlState("status");
  const [range, setRange] = useUrlState("range");
  const [method, setMethod] = useUrlState("method");
  const [search, setSearch] = useUrlState("q");
  const [openId, setOpenId] = useUrlState("order");
  const [draftSearch, setDraftSearch] = useState(search ?? "");
  const q = useDebounced(draftSearch.trim(), 300);
  const tab = tabByKey(tabParam);
  const dates = DATE_RANGES.find((r) => r.key === range)?.key ?? "any";
  const payment: PaymentMethod | undefined = method === "card" || method === "bank_transfer" ? method : undefined;
  const pages = useCursorStack();

  const filters = { tab: tab.key, range: dates, ...(payment ? { method: payment } : {}), ...(q ? { q } : {}) };
  const list = useQuery({
    queryKey: adminKeys.list("orders", { ...filters, cursor: pages.cursor ?? "" }),
    queryFn: ({ signal }) => {
      const from = rangeStart(dates);
      return listAdminOrders({ limit: PAGE, ...(q ? { q } : {}), ...(payment ? { method: payment } : {}), ...(from ? { from } : {}), ...(tab.statuses.length ? { status: tab.statuses.join(",") } : {}), ...(pages.cursor ? { cursor: pages.cursor } : {}) }, { signal });
    },
    placeholderData: (previous) => previous,
  });
  const toAction = useQuery({ queryKey: adminKeys.ordersToAction, queryFn: ({ signal }) => getOrdersToAction({ signal }), staleTime: 30_000 });

  // The counts come with the first page only; keep the last ones while paging.
  const [counts, setCounts] = useState<NonNullable<typeof list.data>["counts"]>(null);
  if (list.data?.counts && list.data.counts !== counts) setCounts(list.data.counts);

  const rows = list.data?.data;
  const range_ = pageRange(pages.index, PAGE, rows?.length ?? 0);
  const filtered = tab.key !== "all" || dates !== "any" || !!payment || !!q;
  const needing = toAction.data ? ordersNeedingAction(toAction.data) : null;

  const changeFilter = (apply: () => void) => {
    pages.reset();
    apply();
  };

  return (
    <>
      <PageHeader title="Orders" subtitle={needing === null ? " " : needing === 0 ? "Nothing needs action right now" : `${needing} need action today`} />

      <div role="group" aria-label="Order status" className="flex flex-wrap gap-2">
        {ORDER_TABS.map((t) => {
          const on = t.key === tab.key;
          return (
            <button key={t.key} type="button" aria-pressed={on} onClick={() => changeFilter(() => setTab(t.key === "all" ? null : t.key))} className={cn("flex h-10 items-center gap-2 rounded-pill border-2 px-3.5 font-bold", on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink")}>
              {t.label}
              {counts ? <span className={cn("text-caption font-semibold", on ? "text-on-primary" : "text-muted")}>{tabCount(t, counts).toLocaleString("en-NG")}</span> : null}
            </button>
          );
        })}
      </div>

      <section aria-label="Order list" className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex flex-wrap gap-2 border-b border-line-soft p-3">
          <label className="flex h-[42px] min-w-[220px] flex-[1_1_240px] items-center gap-2 rounded-pill bg-surface-tint px-3.5">
            <Search aria-hidden="true" size={16} strokeWidth={2} className="text-primary-strong" />
            <span className="sr-only">Search orders</span>
            <input type="search" value={draftSearch} onChange={(e) => { setDraftSearch(e.target.value); pages.reset(); }} onBlur={() => setSearch(q || null)} placeholder="Search by order number, name or phone" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </label>
          <Dropdown aria-label="Date" value={dates} onChange={(e) => changeFilter(() => setRange(e.target.value === "any" ? null : e.target.value))} className={SELECT}>
            {DATE_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Dropdown>
          <Dropdown aria-label="Payment" value={payment ?? ""} onChange={(e) => changeFilter(() => setMethod(e.target.value || null))} className={SELECT}>
            <option value="">Any payment</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
          </Dropdown>
        </div>
        <DataTable
          caption="Orders"
          columns={COLUMNS}
          rows={rows}
          rowKey={(o) => o.id}
          loading={list.isPending}
          error={list.isError && !rows ? { message: "We couldn't load orders.", onRetry: () => void list.refetch() } : undefined}
          empty={<EmptyState title={filtered ? "No orders match" : "No orders here. Nice work."}>{filtered ? "Try a different search or filter." : "New orders will show up here."}</EmptyState>}
          onOpen={(o) => setOpenId(o.id, { push: true })}
          openLabel={(o) => `order ${o.orderNumber}`}
          selectedId={openId}
        />
      </section>
      {rows && rows.length > 0 ? (
        <TablePager from={range_.from} to={range_.to} canPrev={pages.canPrev} canNext={!!list.data?.page.nextCursor} busy={list.isFetching} onPrev={pages.prev} onNext={() => list.data?.page.nextCursor && pages.next(list.data.page.nextCursor)} />
      ) : null}

      {openId ? <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
