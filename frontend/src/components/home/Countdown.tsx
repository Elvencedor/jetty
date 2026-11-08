"use client";

import { useEffect, useState } from "react";
import { describeDuration } from "@/lib/format";

const pad = (n: number) => String(n).padStart(2, "0");

/** Time left until `endsAt`, as labelled boxes (days only when over a day away). Renders nothing after the end (and `onEnd` lets the parent collapse). */
export function Countdown({ endsAt, onEnd }: { endsAt: string; onEnd?: () => void }) {
  const end = Date.parse(endsAt);
  // Starts null so the server and first client render match; the clock appears after mount.
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const ms = end - Date.now();
      setLeft(Math.max(ms, 0));
      if (ms <= 0) onEnd?.();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end, onEnd]);

  if (left === null || Number.isNaN(end)) return null;
  const total = Math.floor(left / 1000);
  const days = Math.floor(total / 86400);
  const parts = [
    ...(days > 0 ? [{ n: days, unit: days === 1 ? "day" : "days" }] : []),
    { n: Math.floor((total % 86400) / 3600), unit: "hrs" },
    { n: Math.floor((total % 3600) / 60), unit: "min" },
    { n: total % 60, unit: "sec" },
  ];
  return (
    // Labelled once with the whole duration; the ticking boxes are hidden so screen readers are not interrupted.
    <span role="timer" aria-label={`Offer ends in ${describeDuration(left)}`} className="inline-flex gap-1.5">
      {parts.map(({ n, unit }) => (
        <span key={unit} aria-hidden="true" className="inline-flex flex-col items-center gap-0.5">
          <span className="inline-flex min-w-[34px] justify-center rounded-xs bg-primary px-[7px] py-1 font-display font-bold tabular-nums text-on-primary">
            {pad(n)}
          </span>
          <span className="text-[10px] uppercase leading-none tracking-wide text-on-inverse-muted">{unit}</span>
        </span>
      ))}
    </span>
  );
}
