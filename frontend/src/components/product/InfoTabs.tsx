"use client";

import { useId, useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui";

/** Details / Fit / Care / Delivery. The text is rendered on the server and passed in, so no markdown code ships to the browser. */
export function InfoTabs({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const id = useId();
  const [selected, setSelected] = useState(tabs[0]?.key ?? "");
  if (!tabs.length) return null;
  const current = tabs.find((t) => t.key === selected) ?? tabs[0]!;
  return (
    <section aria-label="Product information" className="flex flex-col gap-4">
      <Segmented mode="tabs" label="Product information" items={tabs.map((t) => ({ value: t.key, label: t.label }))} value={current.key} onChange={setSelected} />
      <div role="tabpanel" id={`${id}-${current.key}`} tabIndex={0}>
        {current.content}
      </div>
    </section>
  );
}
