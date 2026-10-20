import { Check } from "lucide-react";
import type { OrderStatusValue } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { TRACKER_STEPS, trackerProgress } from "@/lib/status";

/** Five-step progress line. The step in progress is marked `aria-current`; finished steps carry a check. */
export function OrderTracker({ status }: { status: OrderStatusValue }) {
  const done = trackerProgress(status);
  return (
    <ol aria-label="Order progress" className="flex items-start">
      {TRACKER_STEPS.map((label, i) => {
        const complete = i < done;
        const current = i === done - 1;
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {i > 0 ? <span aria-hidden="true" className={cn("absolute right-1/2 top-4 h-[3px] w-full -translate-y-1/2", i < done ? "bg-primary" : "bg-line")} /> : null}
            <span aria-hidden="true" className={cn("relative z-10 flex size-8 items-center justify-center rounded-full text-caption font-bold", complete ? "bg-primary text-on-primary" : "bg-line text-muted")}>
              {complete ? <Check size={16} /> : i + 1}
            </span>
            <span className={cn("text-caption", current ? "font-extrabold text-ink" : complete ? "font-semibold text-ink" : "text-muted")}>
              {label}
              <span className="sr-only">{complete ? (current ? " (current)" : " (done)") : " (to come)"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
