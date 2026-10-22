"use client";

import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Button, EmptyState, Media, Skeleton } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { barPercent, boughtLine, flagsFor, REVIEW_TABS, reviewerLine, reviewTab, starsText } from "@/lib/admin/reviews";
import { useUrlState } from "@/lib/admin/useUrlState";
import { getReviewSummary, listAdminReviews, moderateAdminReview, type AdminReview } from "@/lib/api/admin-reviews";
import { cn } from "@/lib/cn";
import { formatRelativeOrAbsolute } from "@/lib/format";
import { toast } from "@/lib/stores/toast";

const PAGE = 20;
const UNDO_MS = 5000;
type Decision = "approved" | "hidden";

/**
 * Review moderation. Approve and Hide take effect after five seconds, in which the card is replaced by an Undo row: the
 * API does not let a decision be reversed, so nothing is sent until the time is up (or the page is left).
 */
export function ReviewsPage() {
  const queryClient = useQueryClient();
  const [tabParam, setTab] = useUrlState("status");
  const tab = reviewTab(tabParam);
  const key = adminKeys.list("reviews", { status: tab.status });
  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => listAdminReviews({ status: tab.status, limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const counts = useQueries({ queries: REVIEW_TABS.map((t) => ({ queryKey: adminKeys.list("reviews", { count: t.status }), queryFn: ({ signal }: { signal: AbortSignal }) => listAdminReviews({ status: t.status, limit: 1 }, { signal }), staleTime: 15_000 })) });
  const summary = useQuery({ queryKey: adminKeys.detail("reviews", "summary"), queryFn: ({ signal }) => getReviewSummary({ signal }), staleTime: 30_000 });
  const reviews = list.data?.pages.flatMap((p) => p.data);

  // Decisions waiting out their five seconds.
  const [waiting, setWaiting] = useState<Record<string, Decision>>({});
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; to: Decision }>());
  const [active, setActive] = useState(0);
  const [help, setHelp] = useState(false);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("reviews") });
    void queryClient.invalidateQueries({ queryKey: adminKeys.badges });
  }, [queryClient]);

  const send = useCallback(async (id: string, to: Decision) => {
    timers.current.delete(id);
    try {
      await moderateAdminReview(id, to);
    } catch (err) {
      toast.error(adminErrorMessage(err));
    }
    setWaiting((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== id)));
    refresh();
  }, [refresh]);

  function decide(id: string, to: Decision) {
    if (timers.current.has(id)) return;
    setWaiting((w) => ({ ...w, [id]: to }));
    timers.current.set(id, { to, timer: setTimeout(() => void send(id, to), UNDO_MS) });
  }
  function undo(id: string) {
    const held = timers.current.get(id);
    if (held) clearTimeout(held.timer);
    timers.current.delete(id);
    setWaiting((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== id)));
  }

  // Leaving the page makes the decisions that were still waiting.
  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const [id, { timer, to }] of held) {
        clearTimeout(timer);
        void moderateAdminReview(id, to);
      }
      held.clear();
    };
  }, []);

  // Keyboard: J and K move through the queue, A approves, H hides.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest("input, textarea, select, [contenteditable], dialog")) return;
      const open = (reviews ?? []).filter((r) => !waiting[r.id]);
      const k = e.key.toLowerCase();
      if (k === "j") setActive((i) => Math.min(i + 1, Math.max((reviews?.length ?? 1) - 1, 0)));
      else if (k === "k") setActive((i) => Math.max(i - 1, 0));
      else if ((k === "a" || k === "h") && reviews?.[active] && open.includes(reviews[active]!)) {
        if (k === "a" && tab.status !== "pending") return;
        decide(reviews[active]!.id, k === "a" ? "approved" : "hidden");
      } else if (k === "?") setHelp((h) => !h);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-review-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      <PageHeader title="Reviews & questions" subtitle="Only verified buyers can review. Nothing goes live until you approve it." />

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Review queue" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Review status" className="flex flex-wrap rounded-pill border border-line bg-surface p-1">
              {REVIEW_TABS.map((t, i) => {
                const on = t.key === tab.key;
                const total = counts[i]?.data?.page.total;
                return (
                  <button key={t.key} type="button" aria-pressed={on} onClick={() => { setActive(0); setTab(t.key === "pending" ? null : t.key); }} className={cn("flex h-9 items-center gap-2 rounded-pill px-3.5 font-bold", on ? "bg-primary text-on-primary" : "text-ink")}>
                    {t.label}
                    {total !== undefined && total !== null ? <span className={cn("rounded-pill px-2 text-caption", on ? "bg-surface text-primary-strong" : "bg-surface-tint text-primary-strong")}>{total}</span> : null}
                  </button>
                );
              })}
            </div>
            <button type="button" aria-expanded={help} onClick={() => setHelp((h) => !h)} className="inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-body-sm font-semibold text-muted hover:text-ink"><CircleHelp aria-hidden="true" size={16} />Shortcuts</button>
          </div>
          {help ? (
            <p className="rounded-lg bg-surface-tint px-4 py-2.5 text-body-sm"><strong>J</strong> next · <strong>K</strong> previous · <strong>A</strong> approve · <strong>H</strong> hide (while no field is focused)</p>
          ) : null}

          {list.isError && !reviews ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-5 text-danger"><span>{adminErrorMessage(list.error)}</span><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></div>
          ) : !reviews ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-card" />)
          ) : reviews.length === 0 ? (
            <EmptyState title={tab.status === "pending" ? "All caught up" : "Nothing here"}>{tab.status === "pending" ? "New reviews will show up here for approval." : "Reviews you move here will show up in this list."}</EmptyState>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {reviews.map((r, i) => (
                  <li key={r.id} data-review-index={i}>
                    {waiting[r.id] ? <UndoRow decision={waiting[r.id]!} onUndo={() => undo(r.id)} /> : <ReviewCard review={r} current={i === active} canApprove={tab.status === "pending"} onApprove={() => decide(r.id, "approved")} onHide={() => decide(r.id, "hidden")} onFocus={() => setActive(i)} />}
                  </li>
                ))}
              </ul>
              {list.hasNextPage ? <Button variant="outline" className="self-center" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button> : null}
            </>
          )}
        </section>

        <aside aria-label="Store rating" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
          <div className="flex flex-col gap-2.5 rounded-[24px] bg-surface-inverse p-[18px] text-on-inverse">
            <h2 className="text-on-inverse-muted">Store rating</h2>
            {summary.isError ? (
              <p role="alert" className="text-body-sm">We couldn&apos;t load the rating. <button type="button" className="font-bold underline" onClick={() => void summary.refetch()}>Retry</button></p>
            ) : !summary.data ? <Skeleton className="h-32 bg-white/10" /> : summary.data.count === 0 ? (
              <p className="text-on-inverse-muted">No published reviews yet.</p>
            ) : (
              <>
                <p className="flex items-baseline gap-2"><span className="font-display text-display-xl font-extrabold leading-none">{summary.data.average}</span><span className="text-on-inverse-muted">from {summary.data.count.toLocaleString("en-NG")} {summary.data.count === 1 ? "review" : "reviews"}</span></p>
                <ul className="flex flex-col gap-1.5">
                  {summary.data.distribution.map((d) => (
                    <li key={d.stars} className="grid grid-cols-[16px_minmax(0,1fr)_40px] items-center gap-2 text-caption">
                      <span>{d.stars}<span className="sr-only"> stars</span></span>
                      <span aria-hidden="true" className="h-2 rounded bg-surface-inverse-raised"><span className="block h-full rounded bg-pink-350" style={{ width: `${barPercent(d.count, summary.data)}%` }} /></span>
                      <span className="text-right">{barPercent(d.count, summary.data)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function UndoRow({ decision, onUndo }: { decision: Decision; onUndo: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-tint px-4 py-3.5">
      <span className="font-semibold">{decision === "approved" ? "Approved. It goes live in a moment." : "Hidden."}</span>
      <Button size="sm" variant="outline" onClick={onUndo}>Undo</Button>
    </div>
  );
}

function ReviewCard({ review: r, current, canApprove, onApprove, onHide, onFocus }: { review: AdminReview; current: boolean; canApprove: boolean; onApprove: () => void; onHide: () => void; onFocus: () => void }) {
  const flags = canApprove ? flagsFor(r) : [];
  const bought = boughtLine(r);
  return (
    <article onFocusCapture={onFocus} className={cn("flex flex-col gap-2.5 rounded-card border bg-surface p-4", current ? "border-primary" : "border-line")}>
      <div className="flex flex-wrap justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <Media image={r.image} alt="" aspect="5 / 6" sizes="44px" className="w-11 shrink-0 rounded-[12px]" />
          <span className="flex flex-col leading-[1.3]">
            <Link href={`/admin/products?product=${r.productId}`} className="font-bold text-ink underline-offset-2 hover:underline">{r.productTitle}</Link>
            {bought ? <span className="text-caption text-muted">{bought}</span> : null}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span role="img" aria-label={`${r.rating} out of 5 stars`} className="font-extrabold tracking-[1px] text-primary">{starsText(r.rating)}</span>
          <span className="text-caption text-muted">{reviewerLine(r)} · {formatRelativeOrAbsolute(r.createdAt)}</span>
        </div>
      </div>
      {flags.map((f) => <span key={f} className="self-start rounded-[10px] bg-warning-bg px-2.5 py-1 text-caption font-bold text-warning">Check: {f}</span>)}
      {r.title ? <p className="font-bold">{r.title}</p> : null}
      {r.body ? <p className="text-ink-soft">{r.body}</p> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
        {canApprove ? <Button onClick={onApprove}>Approve<span className="sr-only"> review of {r.productTitle}</span></Button> : null}
        <span className="flex-1" />
        {r.status !== "hidden" ? <Button variant="soft" className="bg-neutral-bg text-ink-soft" onClick={onHide}>Hide<span className="sr-only"> review of {r.productTitle}</span></Button> : null}
      </div>
    </article>
  );
}
