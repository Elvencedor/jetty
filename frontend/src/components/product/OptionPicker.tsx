"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ProductDetail } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { choose, firstOpenOption, valuePriceNote, valueState, type Selection } from "@/lib/catalog/variants";
import { formatNairaCompact } from "@/lib/format";

/** Pause before the next step opens after a choice, long enough to see the choice land. */
const ADVANCE_MS = 250;

/** Links offered under a step that benefits from a guide, matched on the option's name. */
const HELP: { match: RegExp; text: string }[] = [
  { match: /length/i, text: "See lengths on a 5′5″ model" },
  { match: /cap|head/i, text: "Measure your head in 1 minute" },
];

type Props = {
  product: Pick<ProductDetail, "options" | "variants" | "defaultVariantId">;
  selection: Selection;
  onChange: (next: Selection) => void;
};

/**
 * "Build your wig": one step open at a time, each row showing its chosen value. Choosing a value opens the next
 * unanswered step shortly after. Values with nothing in stock for the other choices cannot be picked (struck
 * through and announced as sold out); the price notes ("+₦25k", "Included") compare variants and are display only.
 */
export function OptionPicker({ product, selection, onChange }: Props) {
  const [open, setOpen] = useState<string | undefined>(() => firstOpenOption(product, selection));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!product.options.length) return null;

  const pick = (optionId: string, valueId: string) => {
    const next = choose(product, selection, optionId, valueId);
    onChange(next);
    clearTimeout(timer.current);
    const following = firstOpenOption(product, next);
    // The last step stays open; earlier ones hand over to the next one.
    if (following) timer.current = setTimeout(() => setOpen(following), ADVANCE_MS);
  };

  return (
    <section aria-label="Build your wig" className="flex flex-col gap-2">
      {product.options.map((option, n) => {
        const chosen = option.values.find((v) => v.id === selection[option.id]);
        const isOpen = open === option.id;
        const panel = `option-${option.id}`;
        const help = HELP.find((h) => h.match.test(option.name));
        return (
          <div key={option.id} className={cn("rounded-lg border-[1.5px] bg-surface", isOpen ? "border-primary" : "border-line")}>
            <h2>
              <button type="button" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen(isOpen ? undefined : option.id)} className="flex min-h-[58px] w-full items-center gap-3 px-3.5 text-left">
                <span aria-hidden="true" className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-label font-extrabold", isOpen ? "bg-primary text-on-primary" : "bg-surface-tint text-primary-strong")}>{n + 1}</span>
                <span className="flex-1 font-bold">{option.name}</span>
                <span className="text-body-sm font-semibold text-primary-strong">{chosen?.label ?? ""}</span>
                {isOpen ? <ChevronUp aria-hidden="true" size={16} strokeWidth={2.2} /> : <ChevronDown aria-hidden="true" size={16} strokeWidth={2.2} />}
              </button>
            </h2>
            <div id={panel} role="region" aria-label={option.name} hidden={!isOpen} className="flex flex-col gap-2.5 px-3.5 pb-3.5">
              <div className="flex flex-wrap gap-2">
                {option.values.map((value) => {
                  const state = valueState(product, selection, option.id, value.id);
                  const selected = selection[option.id] === value.id;
                  const unavailable = state !== "available" && !selected;
                  const note = valuePriceNote(product, selection, option.id, value.id);
                  const noteText = note ? (note.extraMinor === 0 ? "Included" : `+${formatNairaCompact(note.extraMinor)}`) : null;
                  return (
                    <button
                      key={value.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={unavailable}
                      aria-label={state === "soldOut" || state === "unavailable" ? `${value.label}, sold out` : undefined}
                      onClick={() => pick(option.id, value.id)}
                      className={cn(
                        "flex min-h-11 min-w-14 flex-col items-center justify-center rounded-pill border-[1.5px] px-3.5 py-1 text-body-sm font-semibold leading-[1.15] transition-colors duration-(--duration-base)",
                        selected ? "border-primary bg-primary text-on-primary" : unavailable ? "border-line text-faint line-through" : "border-line-strong bg-surface text-ink",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {value.swatch ? <span aria-hidden="true" className="size-4 rounded-full border border-black/15" style={{ background: value.swatch }} /> : null}
                        {value.label}
                      </span>
                      {noteText && !unavailable ? <span className="text-micro font-medium">{noteText}</span> : null}
                    </button>
                  );
                })}
              </div>
              {help ? <Link href="/pages/size-guide" className="text-label font-semibold text-primary-strong">{help.text}</Link> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
