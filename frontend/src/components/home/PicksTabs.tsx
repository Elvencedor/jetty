"use client";

import { useId, useState } from "react";
import { ProductCard } from "@/components/commerce/ProductCard";
import type { HomeSection } from "@/lib/api/types";
import { cn } from "@/lib/cn";

type Tabs = Extract<HomeSection, { type: "products" }>["tabs"];

/** Tabbed product picks. All tabs arrive with the page, so switching is instant and the grid keeps its height. */
export function PicksTabs({ tabs }: { tabs: Tabs }) {
  const id = useId();
  const populated = tabs.filter((t) => t.products.length > 0);
  const [selected, setSelected] = useState(populated[0]?.key);
  if (!populated.length) return null;
  const current = populated.find((t) => t.key === selected) ?? populated[0]!;
  return (
    <div className="flex flex-col gap-3">
      {populated.length > 1 ? (
        <div role="tablist" aria-label="Pick a group" className="flex gap-1.5 rounded-pill bg-surface-tint p-1">
          {populated.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${id}-${t.key}`}
              aria-selected={t.key === current.key}
              aria-controls={`${id}-panel`}
              onClick={() => setSelected(t.key)}
              className={cn("h-10 flex-1 rounded-pill text-body-sm font-semibold transition-colors duration-(--duration-base)", t.key === current.key ? "bg-surface text-ink" : "text-muted")}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${current.key}`} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {current.products.slice(0, 4).map((p, i) => (
          <ProductCard key={p.id} product={p} layout="pick" tone={i} />
        ))}
      </div>
    </div>
  );
}
