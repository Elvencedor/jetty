import { Hourglass } from "lucide-react";
import { formatDay, formatEstimate } from "@/lib/format";
import type { DeliveryEstimate, DeliveryPrep } from "@/lib/api/types";

/** "Deliveries start on Mon 30 Nov, then take 2 to 4 days." Shown while admin has a preparation period running. */
export function prepSentence(prep: DeliveryPrep, zoneDays: Pick<DeliveryEstimate, "minDays" | "maxDays"> | null): string {
  const day = formatDay(prep.startsOn);
  const start = day === "Today" || day === "Tomorrow" ? day.toLowerCase() : `on ${day}`;
  const takes = zoneDays ? `, then take ${formatEstimate({ minDays: zoneDays.minDays, maxDays: zoneDays.maxDays })}` : "";
  return `We're preparing orders. Deliveries start ${start}${takes}.`;
}

export function PrepNotice({ prep, zoneDays }: { prep: DeliveryPrep; zoneDays: Pick<DeliveryEstimate, "minDays" | "maxDays"> | null }) {
  return (
    <p className="flex items-start gap-2.5 rounded-lg bg-info-bg p-3 text-body-sm text-info">
      <Hourglass aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
      <span>{prepSentence(prep, zoneDays)}</span>
    </p>
  );
}
