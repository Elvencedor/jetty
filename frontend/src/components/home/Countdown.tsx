"use client";

import { useEffect, useState } from "react";
import { describeDuration } from "@/lib/format";

const pad = (n: number) => String(n).padStart(2, "0");

/** Time left until `endsAt`, as HH:MM:SS boxes. Renders nothing after the end (and `onEnd` lets the parent collapse). */
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
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return (
    // Labelled once with the whole duration; the ticking boxes are hidden so screen readers are not interrupted.
    <span role="timer" aria-label={`Offer ends in ${describeDuration(left)}`} className="inline-flex gap-1">
      {parts.map((n, i) => (
        <span key={i} aria-hidden="true" className="inline-flex min-w-8 justify-center rounded-sm bg-primary px-1.5 py-1 font-display text-label font-extrabold tabular-nums text-on-primary">
          {pad(n)}
        </span>
      ))}
    </span>
  );
}
