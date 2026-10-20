"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** What is being counted, for the buttons' names: "Decrease quantity of Bone Straight Wig". */
  label?: string;
  disabled?: boolean;
  className?: string;
};

/** − 1 + control with 44px touch targets. The number is announced politely as it changes. */
export function QuantityStepper({ value, onChange, min = 1, max, label, disabled, className }: Props) {
  const of = label ? ` of ${label}` : "";
  return (
    <div role="group" aria-label={label ? `Quantity of ${label}` : "Quantity"} className={cn("inline-flex items-center rounded-pill bg-surface-tint", className)}>
      <button type="button" aria-label={`Decrease quantity${of}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} className="inline-flex size-11 items-center justify-center rounded-full disabled:opacity-40">
        <Minus aria-hidden="true" size={16} />
      </button>
      <output aria-live="polite" className="w-6 text-center text-body-sm font-bold tabular-nums">{value}</output>
      <button type="button" aria-label={`Increase quantity${of}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} className="inline-flex size-11 items-center justify-center rounded-full disabled:opacity-40">
        <Plus aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
