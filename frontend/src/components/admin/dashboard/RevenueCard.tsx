"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { Button, Skeleton } from "@/components/ui";
import { axisTicks, bucketLabel, CHART, chartMax, chartSummary, deltaOf, linePoints } from "@/lib/admin/dashboard";
import type { Compared, RevenueSeries } from "@/lib/api/admin-dashboard";
import { cn } from "@/lib/cn";
import { formatNaira, formatNairaCompact } from "@/lib/format";

type Props = {
  revenue: Compared | undefined;
  series: RevenueSeries | undefined;
  phrase: string;
  loading: boolean;
  /** True while the previous range's numbers are shown, waiting for the new ones. */
  stale: boolean;
  error: boolean;
  onRetry: () => void;
};

/** The big pink card: revenue for the period against the one before it, as a line chart you can hover and read as a table. */
export function RevenueCard({ revenue, series, phrase, loading, stale, error, onRetry }: Props) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tableId = useId();
  const delta = revenue ? deltaOf(revenue) : null;
  const points = series?.current ?? [];
  const previous = series?.previous ?? [];
  const max = chartMax([points, previous]);
  const empty = !!revenue && (revenue.current ?? 0) === 0;

  function onMove(e: PointerEvent) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(x * (points.length - 1)))));
  }

  return (
    <section aria-label="Revenue" className={cn("flex min-w-0 flex-[2_1_560px] flex-col gap-2.5 rounded-[28px] bg-primary p-5 text-on-primary", stale && "opacity-70")} aria-busy={stale || loading}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-body font-normal">Revenue</h2>
          {revenue ? <span className="font-display text-display-xl font-extrabold">{formatNairaCompact(revenue.current ?? 0)}</span> : <Skeleton className="mt-1 h-10 w-40 bg-white/20" />}
        </div>
        <div className="flex items-center gap-2">
          {delta ? (
            <span className="rounded-pill bg-surface px-3 py-1 text-label font-bold text-primary-strong">
              <span aria-hidden="true">{delta.text}</span>
              <span className="sr-only">Revenue {delta.spoken} on {phrase}</span>
              <span className="ml-1 font-normal text-muted"> vs {phrase}</span>
            </span>
          ) : null}
          <Button size="sm" variant="soft" aria-pressed={table} aria-controls={tableId} onClick={() => setTable((t) => !t)}>{table ? "View as chart" : "View as table"}</Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-surface p-3 text-body-sm text-danger">
          <span>We couldn&apos;t load revenue.</span>
          <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
        </div>
      ) : !series ? (
        <Skeleton className="h-[180px] bg-white/20" />
      ) : table ? (
        <div id={tableId} className="max-h-[220px] overflow-auto rounded-lg bg-surface text-ink">
          <table className="w-full text-body-sm">
            <caption className="sr-only">Revenue by {series.interval}</caption>
            <thead><tr className="text-left text-caption text-muted"><th scope="col" className="px-3 py-2">{series.interval === "day" ? "Day" : series.interval === "week" ? "Week" : "Month"}</th><th scope="col" className="px-3 py-2 text-right">Revenue</th><th scope="col" className="px-3 py-2 text-right">Before</th><th scope="col" className="px-3 py-2 text-right">Orders</th></tr></thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.bucket} className="border-t border-line-soft"><th scope="row" className="px-3 py-1.5 text-left font-semibold">{bucketLabel(p.bucket, series.interval)}</th><td className="px-3 py-1.5 text-right">{formatNaira(p.revenueMinor)}</td><td className="px-3 py-1.5 text-right text-muted">{previous[i] ? formatNaira(previous[i].revenueMinor) : "–"}</td><td className="px-3 py-1.5 text-right">{p.orders}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div id={tableId} ref={box} className="relative touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} preserveAspectRatio="none" role="img" aria-label={chartSummary({ revenue: revenue ?? { current: 0, previous: 0, changePct: null }, phrase, points, interval: series.interval })} className="block h-[180px] w-full">
              <path d={`M0 ${CHART.height / 3}H${CHART.width}M0 ${(CHART.height * 2) / 3}H${CHART.width}`} stroke="var(--color-pink-500)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {empty ? <path d={`M0 ${CHART.height - 2}H${CHART.width}`} stroke="#fff" strokeWidth="3" vectorEffect="non-scaling-stroke" /> : (
                <>
                  <polyline points={linePoints(previous.map((p) => p.revenueMinor), max)} fill="none" stroke="var(--color-pink-350)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                  <polyline points={linePoints(points.map((p) => p.revenueMinor), max)} fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </>
              )}
            </svg>
            {hover !== null && points[hover] && !empty ? (
              <>
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{ left: `${points.length > 1 ? (hover / (points.length - 1)) * 100 : 0}%` }} />
                <div aria-hidden="true" className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-lg bg-surface px-3 py-2 text-caption text-ink shadow-panel" style={{ left: `clamp(72px, ${points.length > 1 ? (hover / (points.length - 1)) * 100 : 0}%, calc(100% - 72px))` }}>
                  <p className="font-bold">{bucketLabel(points[hover].bucket, series.interval)}</p>
                  <p>{formatNaira(points[hover].revenueMinor)} · {points[hover].orders} {points[hover].orders === 1 ? "order" : "orders"}</p>
                  {previous[hover] ? <p className="text-muted">Before: {formatNaira(previous[hover].revenueMinor)}</p> : null}
                </div>
              </>
            ) : null}
          </div>
          <div aria-hidden="true" className="flex justify-between text-caption text-on-primary">
            {axisTicks(points).map((t) => <span key={t.index}>{t.label}</span>)}
          </div>
          {empty ? <p className="text-body-sm">No sales yet in this period.</p> : (
            <p className="flex items-center gap-4 text-caption text-on-primary">
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-[3px] w-5 rounded bg-white" />This period</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-5 border-t-2 border-dashed border-pink-350" />Before</span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
