import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type RadioCardOption<V extends string> = { value: V; title: string; note?: string; aside?: ReactNode; disabled?: boolean; icon?: ReactNode };

type Props<V extends string> = {
  legend: string;
  name: string;
  options: RadioCardOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  /** `list`: one card per row with an icon tile and a price (delivery speed). `tiles`: a 2-column grid (payment method). */
  layout?: "list" | "tiles";
  /** Hide the legend visually (the screen's heading already says it). */
  hideLegend?: boolean;
};

/** A group of card-shaped native radios, so arrow keys, focus and form semantics all come from the browser. */
export function RadioCards<V extends string>({ legend, name, options, value, onChange, layout = "list", hideLegend = false }: Props<V>) {
  const tiles = layout === "tiles";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={cn("mb-2 font-bold", hideLegend && "sr-only")}>{legend}</legend>
      <div className={cn(tiles ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer border-2 transition-colors duration-(--duration-base) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              tiles ? "min-h-24 flex-col justify-between rounded-lg p-3" : "min-h-16 items-center gap-3 rounded-[18px] px-3.5 py-2.5",
              value === o.value ? "border-primary bg-surface-tint" : "border-line bg-surface",
              o.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="sr-only" />
            {o.icon ? (
              tiles ? <span aria-hidden="true" className="text-primary">{o.icon}</span> : <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface text-primary">{o.icon}</span>
            ) : null}
            <span className={cn("flex flex-col leading-[1.3]", !tiles && "min-w-0 flex-1")}>
              <span className="font-bold">{o.title}</span>
              {o.note ? <span className="text-caption text-muted">{o.note}</span> : null}
            </span>
            {o.aside ? <span className="shrink-0 font-bold">{o.aside}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
