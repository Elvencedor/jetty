import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type RadioCardOption<V extends string> = { value: V; title: string; note?: string; aside?: ReactNode; disabled?: boolean; icon?: ReactNode };

/** A group of card-shaped native radios, so arrow keys, focus and form semantics all come from the browser. */
export function RadioCards<V extends string>({ legend, name, options, value, onChange }: { legend: string; name: string; options: RadioCardOption<V>[]; value: V | null; onChange: (value: V) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-label font-bold">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary", value === o.value ? "border-primary bg-surface-tint" : "border-line", o.disabled && "cursor-not-allowed opacity-50")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="size-5 accent-primary" />
          {o.icon ? <span aria-hidden="true" className="text-primary-strong">{o.icon}</span> : null}
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-bold">{o.title}</span>
            {o.note ? <span className="block text-caption text-muted">{o.note}</span> : null}
          </span>
          {o.aside ? <span className="shrink-0 text-body-sm font-bold">{o.aside}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}
