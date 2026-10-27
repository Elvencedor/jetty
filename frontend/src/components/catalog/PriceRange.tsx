"use client";

import { formatNaira } from "@/lib/format";

type Props = {
  /** The cheapest and dearest price in the catalogue, in whole naira. */
  min: number;
  max: number;
  /** The chosen range in whole naira; undefined ends mean "no limit". */
  from: number | undefined;
  to: number | undefined;
  onChange: (range: { from: number | undefined; to: number | undefined }) => void;
};

const STEP = 1000;

/**
 * A two-thumb price slider built from two native range inputs laid over one track, so keyboard, touch and screen
 * readers work without any custom handling. The two number fields below are the precise fallback.
 */
export function PriceRange({ min, max, from, to, onChange }: Props) {
  const low = Math.min(Math.max(from ?? min, min), max);
  const high = Math.min(Math.max(to ?? max, min), max);
  const pct = (v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100);
  const set = (nextLow: number, nextHigh: number) => onChange({ from: nextLow <= min ? undefined : nextLow, to: nextHigh >= max ? undefined : nextHigh });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-bold">Price</span>
        <span className="text-body-sm text-muted">{formatNaira(low * 100)} – {formatNaira(high * 100)}</span>
      </div>
      <div className="relative h-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-2.5 h-1 rounded-xs bg-pink-200" />
        <span aria-hidden="true" className="absolute top-2.5 h-1 bg-primary" style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }} />
        {([["Minimum price", low, (v: number) => set(Math.min(v, high), high)], ["Maximum price", high, (v: number) => set(low, Math.max(v, low))]] as const).map(([label, value, update]) => (
          <input
            key={label}
            type="range"
            aria-label={label}
            aria-valuetext={formatNaira(value * 100)}
            min={min}
            max={max}
            step={STEP}
            value={value}
            onChange={(e) => update(Number(e.target.value))}
            className="pointer-events-none absolute inset-0 h-6 w-full appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-white [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-white focus-visible:[&::-webkit-slider-thumb]:outline-2 focus-visible:[&::-webkit-slider-thumb]:outline-offset-2 focus-visible:[&::-webkit-slider-thumb]:outline-primary"
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {([["Minimum price in naira", from, (v: number | undefined) => onChange({ from: v, to })], ["Maximum price in naira", to, (v: number | undefined) => onChange({ from, to: v })]] as const).map(([label, value, update]) => (
          <input
            key={label}
            aria-label={label}
            inputMode="numeric"
            placeholder={label.startsWith("Min") ? String(min) : String(max)}
            value={value ?? ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
              update(digits ? Number(digits) : undefined);
            }}
            className="h-11 w-full min-w-0 rounded-pill border-[1.5px] border-line-strong px-4 text-body-sm"
          />
        ))}
      </div>
    </div>
  );
}
