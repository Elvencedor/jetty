"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { SideDrawer } from "../SideDrawer";
import { Button } from "@/components/ui";
import { selectAllState } from "@/lib/admin/selection";
import { cn } from "@/lib/cn";

export type Noun = { one: string; many: string };
export const countText = (n: number, noun: Noun) => `${n.toLocaleString("en-NG")} ${n === 1 ? noun.one : noun.many}`;

/**
 * "Select all shown": empty, ticked, or a dash when only some of what is on screen is selected, with a line saying how
 * many. It acts on what is shown now, and never on items elsewhere, so it can't select things the admin cannot see.
 */
export function SelectAllToggle({ shown, has, noun, onChange }: { shown: string[]; has: (id: string) => boolean; noun: Noun; onChange: (on: boolean) => void }) {
  const state = selectAllState(shown, has);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === "some"; }, [state]);
  const chosen = shown.filter(has).length;
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-pill pr-3 text-body-sm font-semibold">
      <input ref={ref} type="checkbox" checked={state === "all"} onChange={() => onChange(state !== "all")} className="size-[22px] cursor-pointer accent-primary" />
      <span>{state === "all" ? `All ${countText(shown.length, noun)} shown selected` : state === "some" ? `${chosen} of ${countText(shown.length, noun)} shown selected` : `Select all ${countText(shown.length, noun)} shown`}</span>
    </label>
  );
}

/**
 * The bar that is on screen whenever anything is selected, whichever page or filter it came from: how many, how many are
 * out of sight, a way to look at them all, a way to start over, and the actions. It is also announced to screen readers.
 */
export function SelectionBar({ noun, count, hiddenCount, busy, onReview, onClear, children }: { noun: Noun; count: number; hiddenCount: number; busy?: boolean; onReview: () => void; onClear: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const showing = count > 0;
  // Toasts sit above the bar instead of on top of its buttons.
  useEffect(() => {
    if (!showing) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--bulk-bar-height", `${ref.current?.offsetHeight ?? 0}px`);
    measure();
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); root.style.removeProperty("--bulk-bar-height"); };
  }, [showing, count, hiddenCount]);
  if (!showing) return null;
  return (
    <section ref={ref} aria-label="Bulk actions" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-drawer">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2 px-[clamp(16px,3vw,36px)] py-3">
        <p role="status" aria-live="polite" className="flex min-w-0 flex-[1_1_200px] items-center gap-2.5">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"><Check size={18} strokeWidth={2.6} /></span>
          <span className="flex min-w-0 flex-col leading-[1.25]">
            <span className="font-bold">{countText(count, noun)} selected</span>
            {hiddenCount > 0 ? <span className="text-caption text-muted">{hiddenCount} not shown with this search or filter</span> : null}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onReview}>Review</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onClear}>Clear</Button>
          <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
          {children}
        </div>
      </div>
    </section>
  );
}

export type ReviewItem = { id: string; label: string; detail?: string | undefined };

/** Everything that is selected, in one list, so nothing is ever selected out of sight. Each can be taken out. */
export function ReviewSelection({ open, title, items, noun, flagged, onRemove, onClear, onClose, footerNote }: { open: boolean; title: string; items: ReviewItem[]; noun: Noun; /** Ids to point out, with the reason (items that could not be changed). */ flagged?: Record<string, string>; onRemove: (id: string) => void; onClear: () => void; onClose: () => void; footerNote?: ReactNode }) {
  return (
    <SideDrawer open={open} onClose={onClose} title={title} subtitle={items.length === 0 ? undefined : `${countText(items.length, noun)} selected`} footer={<><Button variant="outline" disabled={items.length === 0} onClick={onClear}>Clear all</Button><Button onClick={onClose}>Done</Button></>}>
      {items.length === 0 ? (
        <p className="text-body-sm text-muted">Nothing is selected.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
              <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                <span className="truncate font-semibold">{it.label}</span>
                {it.detail ? <span className="text-caption text-muted">{it.detail}</span> : null}
                {flagged?.[it.id] ? <span className="text-caption font-medium text-danger">{flagged[it.id]}</span> : null}
              </span>
              <button type="button" aria-label={`Remove ${it.label} from the selection`} onClick={() => onRemove(it.id)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-tint"><X aria-hidden="true" size={18} /></button>
            </li>
          ))}
        </ul>
      )}
      {footerNote ? <div className={cn("mt-3 text-caption text-muted")}>{footerNote}</div> : null}
    </SideDrawer>
  );
}
