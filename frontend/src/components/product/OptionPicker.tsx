"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Chip } from "@/components/ui";
import type { ProductDetail } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { choose, firstOpenOption, valueState, type Selection } from "@/lib/catalog/variants";

type Props = {
  product: Pick<ProductDetail, "options" | "variants" | "defaultVariantId">;
  selection: Selection;
  onChange: (next: Selection) => void;
};

/**
 * "Build your wig": one step open at a time. Choosing a value closes its step and opens the next unanswered one.
 * Combinations that are sold out are struck through; ones that were never made cannot be picked.
 */
export function OptionPicker({ product, selection, onChange }: Props) {
  const [open, setOpen] = useState<string | undefined>(() => firstOpenOption(product, selection));
  if (!product.options.length) return null;

  const pick = (optionId: string, valueId: string) => {
    const next = choose(product, selection, optionId, valueId);
    onChange(next);
    setOpen(firstOpenOption(product, next));
  };

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-heading-sm font-extrabold">Build your wig</h2>
      {product.options.map((option, n) => {
        const chosen = option.values.find((v) => v.id === selection[option.id]);
        const isOpen = open === option.id;
        const panel = `option-${option.id}`;
        return (
          <section key={option.id} className="overflow-hidden rounded-card border border-line">
            <h3>
              <button type="button" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen(isOpen ? undefined : option.id)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
                <span aria-hidden="true" className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-bold", chosen ? "bg-primary text-on-primary" : "bg-surface-tint text-primary-strong")}>
                  {chosen ? <Check size={14} /> : n + 1}
                </span>
                <span className="flex-1 text-body-sm font-bold">{option.name}</span>
                <span className="text-body-sm text-muted">{chosen ? chosen.label : "Choose"}</span>
              </button>
            </h3>
            <div id={panel} hidden={!isOpen} className="flex flex-wrap gap-2 px-4 pb-4">
              {option.values.map((value) => {
                const state = valueState(product, selection, option.id, value.id);
                const selected = selection[option.id] === value.id;
                return (
                  <Chip
                    key={value.id}
                    large
                    selected={selected}
                    aria-pressed={selected}
                    disabled={state === "unavailable"}
                    // A sold-out value stays selectable so the shopper can see why Add to bag is off.
                    className={state === "soldOut" ? "line-through opacity-60" : undefined}
                    onClick={() => pick(option.id, value.id)}
                  >
                    {value.swatch ? <span aria-hidden="true" className="size-4 rounded-full border border-white shadow-swatch-inset" style={{ background: value.swatch }} /> : null}
                    {value.label}
                    {state === "soldOut" ? <span className="sr-only"> (sold out)</span> : null}
                  </Chip>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
