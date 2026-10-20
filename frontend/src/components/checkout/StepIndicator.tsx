import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export const STEPS = [
  { key: "delivery", label: "Delivery" },
  { key: "payment", label: "Payment" },
  { key: "review", label: "Review" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

/** Three-segment progress track. Finished steps are buttons that go back to edit them. */
export function StepIndicator({ current, onGo }: { current: StepKey; onGo: (step: StepKey) => void }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex gap-1 rounded-pill bg-surface-tint p-1" aria-label="Checkout steps">
      {STEPS.map((step, i) => {
        const done = i < at;
        const active = i === at;
        const body = (
          <>
            <span aria-hidden="true" className={cn("flex size-5 items-center justify-center rounded-full text-micro font-bold", active ? "bg-white text-primary-strong" : done ? "bg-ink text-white" : "bg-line text-muted")}>
              {done ? <Check size={12} /> : i + 1}
            </span>
            <span>{done ? <><span className="sr-only">Edit </span>{step.label}</> : step.label}</span>
          </>
        );
        const cls = cn("flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-pill px-2 text-label font-semibold", active ? "bg-primary text-on-primary" : done ? "text-ink" : "text-muted");
        return (
          <li key={step.key} className="flex flex-1" aria-current={active ? "step" : undefined}>
            {done ? <button type="button" onClick={() => onGo(step.key)} className={cls}>{body}</button> : <span className={cls}>{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}
