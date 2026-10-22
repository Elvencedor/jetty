"use client";

import { Star } from "lucide-react";
import { Media } from "@/components/ui";
import type { AdminProductRow } from "@/lib/api/admin-catalog";
import { cn } from "@/lib/cn";
import { formatNairaKRange } from "@/lib/format";

/** Units per variant that fill the stock bar; under this many in total the bar turns red (the design's "red under 10"). */
const LOW_TOTAL = 10;

const PILL = { success: "bg-success-bg text-success", neutral: "bg-neutral-bg text-ink-soft", danger: "bg-danger-bg text-danger" } as const;

/** What the pill says: out of stock beats the status for a live product. */
export function productPill(p: Pick<AdminProductRow, "status" | "availableQuantity">): { label: string; tone: "success" | "neutral" | "danger" } {
  if (p.status === "archived") return { label: "Archived", tone: "neutral" };
  if (p.status === "draft") return { label: "Draft", tone: "neutral" };
  return p.availableQuantity <= 0 ? { label: "Out of stock", tone: "danger" } : { label: "Active", tone: "success" };
}

type Props = {
  product: AdminProductRow;
  selected: boolean;
  /** Absent when the admin cannot edit the catalogue. */
  onToggleFeatured?: (featured: boolean) => void;
  onOpen: () => void;
};

/** One product in the catalogue grid: photo with status and featured star, name, variants and price range, stock meter. */
export function ProductCard({ product: p, selected, onToggleFeatured, onOpen }: Props) {
  const pill = productPill(p);
  const low = p.availableQuantity < LOW_TOTAL;
  const pct = Math.min(100, Math.round((p.availableQuantity / Math.max(p.variantCount * LOW_TOTAL, 1)) * 100));
  return (
    <article className={cn("flex flex-col gap-2 rounded-card border-2 bg-surface p-2", selected ? "border-primary" : "border-transparent")}>
      <div className="relative">
        <Media image={p.coverUrl ? { url: p.coverUrl } : null} alt="" aspect="1 / 0.9" className="rounded-md" sizes="200px" />
        <span className={cn("absolute left-2 top-2 rounded-[9px] px-2 py-0.5 text-micro font-bold", PILL[pill.tone])}>{pill.label}</span>
        {onToggleFeatured ? (
          <button type="button" aria-pressed={p.featured} aria-label={`Feature ${p.title} on homepage`} onClick={() => onToggleFeatured(!p.featured)} className="absolute right-0.5 top-0.5 inline-flex size-11 items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-surface"><Star aria-hidden="true" size={18} className={cn("text-primary", p.featured && "fill-primary")} /></span>
          </button>
        ) : null}
      </div>
      <button type="button" onClick={onOpen} className="flex flex-col gap-1 px-1 text-left">
        <span className="font-bold leading-[1.3]">{p.title}</span>
        <span className="text-caption text-muted">{p.variantCount} {p.variantCount === 1 ? "variant" : "variants"}{p.minPriceMinor !== null ? ` · ${formatNairaKRange(p.minPriceMinor, p.maxPriceMinor ?? p.minPriceMinor)}` : ""}</span>
        <span className="flex w-full items-center gap-2 text-caption">
          <span aria-hidden="true" className="h-1.5 flex-1 rounded-xs bg-plum-50"><span className={cn("block h-1.5 rounded-xs", low ? "bg-danger" : "bg-primary")} style={{ width: `${pct}%` }} /></span>
          <span className={cn("font-bold", low ? "text-danger" : "text-ink")}>{p.availableQuantity} left</span>
        </span>
      </button>
    </article>
  );
}
