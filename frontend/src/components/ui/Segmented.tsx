"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type SegmentedItem<V extends string> = { value: V; label: string; count?: number };

type Props<V extends string> = {
  items: SegmentedItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the whole control. */
  label: string;
  /** `white` selected pill (tabs) or `primary` selected pill (range pickers, status filters). Keep one style per screen. */
  tone?: "white" | "primary";
  /** `tabs` swaps content (role tablist, arrow keys); `filter` filters a list (buttons with aria-pressed). */
  mode?: "tabs" | "filter";
  /** Each option is its own outlined button, so a choice between a few things reads as buttons even when none is selected. */
  outlined?: boolean;
  className?: string;
};

/** Pill track holding pill buttons. */
export function Segmented<V extends string>({ items, value, onChange, label, tone = "white", mode = "filter", outlined = false, className }: Props<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = mode === "tabs";
  // Exactly one tab is a tab stop. If `value` matches nothing, the first item is, so the control is never unreachable.
  const stop = Math.max(0, items.findIndex((item) => item.value === value));

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (!tabs) return;
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = (next + items.length) % items.length;
    refs.current[target]?.focus();
    onChange(items[target]!.value);
  }

  return (
    <div role={tabs ? "tablist" : "group"} aria-label={label} className={cn("inline-flex max-w-full overflow-x-auto", outlined ? "gap-2" : "gap-1 rounded-pill bg-surface-tint p-1", className)}>
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? selected : undefined}
            aria-pressed={tabs ? undefined : selected}
            tabIndex={tabs && i !== stop ? -1 : 0}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-label font-semibold transition-colors duration-(--duration-base) ease-standard",
              outlined
                ? cn("border-[1.5px]", selected ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-surface text-ink hover:border-primary")
                : selected ? (tone === "primary" ? "bg-primary text-on-primary" : "bg-surface text-ink") : "text-muted hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              // A small badge of its own, so the number reads as a count and not as part of the label.
              <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-micro font-bold leading-none", selected ? (tone === "primary" ? "bg-white/25 text-on-primary" : "bg-primary text-on-primary") : "bg-surface text-ink-soft")}>{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
