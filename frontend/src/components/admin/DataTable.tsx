"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
  /** Extra classes for the column's cells (a width, for instance). */
  className?: string;
};

type Selection = { ids: ReadonlySet<string>; onChange: (ids: Set<string>) => void };

type Props<T> = {
  /** Names the table for assistive technology ("Orders"). */
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: { message: string; onRetry: () => void } | undefined;
  /** Shown instead of the table body when there are no rows. */
  empty?: ReactNode;
  /** Makes the first cell a button that opens the row (usually its drawer). */
  onOpen?: (row: T) => void;
  openLabel?: (row: T) => string;
  /** The row whose drawer is open, highlighted. */
  selectedId?: string | null;
  /** Checkboxes for bulk actions. */
  selection?: Selection;
  skeletonRows?: number;
};

/**
 * The admin list: header row, rows divided by a faint line, first cell opens the row, optional checkboxes, skeleton
 * rows while loading and the failure shown inside the card with a Retry (never a blank page). It scrolls sideways
 * inside its card on narrow screens instead of squeezing the columns. Paging lives outside, in `TablePager`.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, loading, error, empty, onOpen, openLabel, selectedId, selection, skeletonRows = 6 }: Props<T>) {
  const allBox = useRef<HTMLInputElement>(null);
  const id = useId();
  const ids = (rows ?? []).map(rowKey);
  const selectedCount = selection ? ids.filter((i) => selection.ids.has(i)).length : 0;
  // "Some but not all" is a visual state the browser only lets us set on the element.
  const partly = selectedCount > 0 && selectedCount < ids.length;
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = partly;
  }, [partly]);

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.ids);
    if (selectedCount === ids.length) ids.forEach((i) => next.delete(i));
    else ids.forEach((i) => next.add(i));
    selection.onChange(next);
  };
  const toggle = (rowId: string) => {
    if (!selection) return;
    const next = new Set(selection.ids);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    selection.onChange(next);
  };

  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-5 text-body-sm">
        <span className="text-danger">{error.message}</span>
        <Button size="sm" variant="outline" onClick={error.onRetry}>Retry</Button>
      </div>
    );
  }
  if (!loading && rows && rows.length === 0 && empty) return <div className="rounded-card border border-line bg-surface p-5">{empty}</div>;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="overflow-x-auto">
        <table aria-busy={loading} className="w-full min-w-[620px] border-collapse text-body-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-caption font-semibold text-muted">
              {selection ? (
                <th scope="col" className="w-11 px-3 py-2.5">
                  <input ref={allBox} type="checkbox" aria-label={`Select all ${caption.toLowerCase()} on this page`} checked={ids.length > 0 && selectedCount === ids.length} onChange={toggleAll} className="size-[18px] accent-primary" />
                </th>
              ) : null}
              {columns.map((c) => <th key={c.key} scope="col" className={cn("px-4 py-2.5", c.align === "right" && "text-right", c.className)}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading || !rows
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i} aria-hidden="true" className="border-b border-line-soft last:border-0">
                    {selection ? <td className="px-3 py-3"><Skeleton className="size-[18px]" /></td> : null}
                    {columns.map((c) => <td key={c.key} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-40" /></td>)}
                  </tr>
                ))
              : rows.map((row) => {
                  const rowId = rowKey(row);
                  return (
                    <tr key={rowId} aria-selected={selectedId === rowId || undefined} className={cn("border-b border-line-soft last:border-0", selectedId === rowId && "bg-surface-tint")}>
                      {selection ? (
                        <td className="w-11 px-3 py-3">
                          <input type="checkbox" id={`${id}-${rowId}`} aria-label={`Select ${openLabel?.(row) ?? rowId}`} checked={selection.ids.has(rowId)} onChange={() => toggle(rowId)} className="size-[18px] accent-primary" />
                        </td>
                      ) : null}
                      {columns.map((c, i) => (
                        <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right", c.className)}>
                          {i === 0 && onOpen ? (
                            <button type="button" onClick={() => onOpen(row)} aria-label={openLabel ? `Open ${openLabel(row)}` : undefined} className="text-left font-semibold text-ink underline-offset-2 hover:underline">{c.cell(row)}</button>
                          ) : c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
