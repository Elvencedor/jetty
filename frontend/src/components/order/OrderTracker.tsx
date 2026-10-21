import { ClipboardCheck, CreditCard, Package, PackageCheck, Truck, type LucideIcon } from "lucide-react";
import type { OrderStatusValue } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { TRACKER_STEPS, trackerProgress } from "@/lib/status";

const ICONS: LucideIcon[] = [ClipboardCheck, CreditCard, Package, Truck, PackageCheck];

/**
 * Five steps joined by a line. Finished steps are filled pink; the step that is happening now is outlined in pink;
 * the rest are quiet. The current step is marked `aria-current` and every step says where it stands in words.
 */
export function OrderTracker({ status }: { status: OrderStatusValue }) {
  const done = trackerProgress(status);
  return (
    <ol aria-label="Order progress" className="flex">
      {TRACKER_STEPS.map((label, i) => {
        const complete = i < done;
        const now = i === done;
        const Icon = ICONS[i]!;
        return (
          <li key={label} aria-current={now ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {i > 0 ? <span aria-hidden="true" className={cn("absolute right-1/2 top-[15px] h-[3px] w-full", i <= done ? "bg-primary" : "bg-line")} /> : null}
            <span aria-hidden="true" className={cn("relative flex size-8 items-center justify-center rounded-full border-2", complete ? "border-primary bg-primary text-on-primary" : now ? "border-primary bg-surface text-primary" : "border-line bg-surface text-muted")}>
              <Icon size={16} strokeWidth={2} />
            </span>
            <span className={cn("text-micro leading-[1.2]", now ? "font-extrabold text-ink" : complete ? "font-semibold text-ink" : "text-muted")}>
              {label}
              <span className="sr-only">{complete ? " (done)" : now ? " (next)" : " (to come)"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
