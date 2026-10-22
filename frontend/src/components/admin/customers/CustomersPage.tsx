"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { DataTable, type Column } from "../DataTable";
import { PageHeader } from "../PageHeader";
import { TablePager } from "../TablePager";
import { EmptyState, Skeleton, StatusPill } from "@/components/ui";
import { useDebounced } from "@/components/shell/useDebounced";
import { adminKeys } from "@/lib/admin/keys";
import { avatarTone, displayName, initials, PHOTO_BG, placeOf, segmentFromParam, SEGMENT_TAG } from "@/lib/admin/customers";
import { pageRange, useCursorStack } from "@/lib/admin/useCursorStack";
import { useUrlState } from "@/lib/admin/useUrlState";
import { getCustomerSegments, listAdminCustomers, type CustomerRow, type SegmentKey } from "@/lib/api/admin-customers";
import { cn } from "@/lib/cn";
import { formatNairaCompact, formatRelativeOrAbsolute } from "@/lib/format";
import { CustomerDrawer } from "./CustomerDrawer";

const PAGE = 20;

const COLUMNS: Column<CustomerRow>[] = [
  {
    key: "customer",
    header: "Customer",
    cell: (c) => (
      <span className="flex items-center gap-2.5">
        <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-label font-extrabold text-primary-deep", PHOTO_BG[avatarTone(c.id)])}>{initials(c)}</span>
        <span className="flex min-w-0 flex-col leading-[1.3]">
          <span className="truncate font-bold">{displayName(c)}</span>
          <span className="truncate text-caption font-normal text-muted">{placeOf(c) || c.email || c.phone}</span>
        </span>
      </span>
    ),
  },
  { key: "orders", header: "Orders", cell: (c) => c.orderCount },
  { key: "spent", header: "Spent", className: "font-bold", cell: (c) => (c.lifetimeValueMinor ? formatNairaCompact(c.lifetimeValueMinor) : "–") },
  { key: "last", header: "Last order", cell: (c) => (c.lastOrderAt ? formatRelativeOrAbsolute(c.lastOrderAt) : "Never") },
  { key: "tags", header: "Tags", cell: (c) => <span className="flex flex-wrap gap-1">{c.segments.map((s) => <StatusPill key={s} tone={SEGMENT_TAG[s].tone} className="px-2 py-0.5 text-micro">{SEGMENT_TAG[s].label}</StatusPill>)}</span> },
];

/** Customers: segment tiles that filter the list, search, and a profile drawer (`?customer=<id>`). */
export function CustomersPage() {
  const [segmentParam, setSegment] = useUrlState("segment");
  const [search, setSearch] = useUrlState("q");
  const [openId, setOpenId] = useUrlState("customer");
  const [draft, setDraft] = useState(search ?? "");
  const q = useDebounced(draft.trim(), 300);
  const segment = segmentFromParam(segmentParam);
  const pages = useCursorStack();

  const segments = useQuery({ queryKey: adminKeys.list("customers", { segments: true }), queryFn: ({ signal }) => getCustomerSegments({ signal }), staleTime: 60_000 });
  const list = useQuery({
    queryKey: adminKeys.list("customers", { segment, q, cursor: pages.cursor ?? "" }),
    queryFn: ({ signal }) => listAdminCustomers({ limit: PAGE, sort: "newest", ...(q ? { q } : {}), ...(segment ? { segment } : {}), ...(pages.cursor ? { cursor: pages.cursor } : {}) }, { signal }),
    placeholderData: (previous) => previous,
  });
  const rows = list.data?.data;
  const range = pageRange(pages.index, PAGE, rows?.length ?? 0);
  const filtered = !!segment || !!q;

  const pick = (key: SegmentKey | null) => {
    pages.reset();
    setSegment(key);
  };
  const tiles: { key: SegmentKey | null; label: string; note: string; count: number | undefined }[] = [
    { key: null, label: "Everyone", note: "All customers", count: segments.data?.everyone },
    ...(segments.data?.segments ?? (["vip", "new", "returning", "lapsed"] as const).map((key) => ({ key, label: SEGMENT_TAG[key].label, rule: "", count: undefined }))).map((s) => ({ key: s.key as SegmentKey, label: s.label, note: s.rule, count: s.count })),
  ];

  return (
    <>
      <PageHeader title="Customers" subtitle={segments.data ? `${segments.data.everyone.toLocaleString("en-NG")} ${segments.data.everyone === 1 ? "customer" : "customers"}` : " "} />

      <section aria-label="Segments" className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2.5">
        {tiles.map((t) => {
          const on = (t.key ?? null) === segment;
          return (
            <button key={t.key ?? "all"} type="button" aria-pressed={on} onClick={() => pick(t.key)} className={cn("flex flex-col rounded-[20px] border-2 px-4 py-3.5 text-left", on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink")}>
              {t.count === undefined ? <Skeleton className={cn("h-7 w-12", on && "bg-white/30")} /> : <span className="font-display text-heading-md font-extrabold leading-[1.1]">{t.count.toLocaleString("en-NG")}</span>}
              <span className="font-bold">{t.label}</span>
              <span className={cn("text-caption", on ? "text-on-primary" : "text-muted")}>{t.note}</span>
            </button>
          );
        })}
      </section>

      <section aria-label="Customer list" className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="border-b border-line-soft p-3">
          <label className="flex h-[42px] items-center gap-2 rounded-pill bg-surface-tint px-3.5">
            <Search aria-hidden="true" size={16} strokeWidth={2} className="text-primary-strong" />
            <span className="sr-only">Search customers</span>
            <input type="search" value={draft} onChange={(e) => { setDraft(e.target.value); pages.reset(); }} onBlur={() => setSearch(q || null)} placeholder="Search by phone or email" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </label>
        </div>
        <DataTable
          caption="Customers"
          columns={COLUMNS}
          rows={rows}
          rowKey={(c) => c.id}
          loading={list.isPending}
          error={list.isError && !rows ? { message: "We couldn't load customers.", onRetry: () => void list.refetch() } : undefined}
          empty={<EmptyState title={filtered ? "No customers match" : "No customers yet"}>{filtered ? "Try a different segment or search." : "People who create an account will show up here."}</EmptyState>}
          onOpen={(c) => setOpenId(c.id, { push: true })}
          selectedId={openId}
        />
      </section>
      {rows && rows.length > 0 ? <TablePager from={range.from} to={range.to} canPrev={pages.canPrev} canNext={!!list.data?.page.nextCursor} busy={list.isFetching} onPrev={pages.prev} onNext={() => list.data?.page.nextCursor && pages.next(list.data.page.nextCursor)} /> : null}

      {openId ? <CustomerDrawer customerId={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

