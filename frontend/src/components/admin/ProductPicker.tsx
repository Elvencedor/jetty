"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { useDebounced } from "@/components/shell/useDebounced";
import { Button, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { listAdminProducts } from "@/lib/api/admin-catalog";

type Props = {
  /** Names the chooser, for assistive technology and the search box. */
  label: string;
  ids: string[];
  /** What each chosen id is called (the parent remembers what was picked, and looks up the rest). */
  titles: ReadonlyMap<string, string>;
  onAdd: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  max?: number;
};

/** Search the on-sale products and pick some; the chosen ones are listed with a way to take each back out. */
export function ProductPicker({ label, ids, titles, onAdd, onRemove, disabled, max = 50 }: Props) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const results = useQuery({ queryKey: adminKeys.list("products", { picker: q }), queryFn: ({ signal }) => listAdminProducts({ ...(q ? { q } : {}), status: "active", limit: 8 }, { signal }), enabled: !disabled, staleTime: 30_000 });
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      {ids.length ? (
        <ul aria-label={`Chosen: ${label}`} className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const title = titles.get(id) ?? "Product";
            return (
              <li key={id} className="inline-flex items-center gap-1 rounded-pill bg-surface-tint py-1 pl-3 pr-1 text-label font-semibold text-primary-strong">
                {title}
                {!disabled ? <button type="button" aria-label={`Remove ${title}`} onClick={() => onRemove(id)} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-surface-blush"><X aria-hidden="true" size={12} /></button> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!disabled ? (
        <>
          <TextField size="admin" label={`Find a product: ${label}`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
          {results.isError ? <p role="alert" className="text-body-sm text-danger">{adminErrorMessage(results.error)}</p> : (
            <ul className="flex flex-col gap-1.5">
              {results.data?.data.map((p) => {
                const added = ids.includes(p.id);
                return <li key={p.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-subtle px-3 py-2"><span className="min-w-0 truncate">{p.title}</span><Button size="sm" variant="outline" disabled={added || ids.length >= max} onClick={() => onAdd(p.id, p.title)}>{added ? "Added" : "Add"}<span className="sr-only"> {p.title}</span></Button></li>;
              })}
              {results.data && results.data.data.length === 0 ? <li className="text-body-sm text-muted">No products match.</li> : null}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
