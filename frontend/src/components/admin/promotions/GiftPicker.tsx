"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDebounced } from "@/components/shell/useDebounced";
import { Button, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { getAdminProduct, listAdminProducts } from "@/lib/api/admin-catalog";
import { formatNaira } from "@/lib/format";

type Props = {
  /** The chosen gift, in words; empty when none is chosen yet. */
  label: string;
  priceMinor: number;
  error?: string | undefined;
  onPick: (gift: { variantId: string; label: string; priceMinor: number }) => void;
};

/** Pick the product to give away, then which variant of it (a bonnet in champagne, say). */
export function GiftPicker({ label, priceMinor, error, onPick }: Props) {
  const [changing, setChanging] = useState(!label);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 300);
  const results = useQuery({ queryKey: adminKeys.list("products", { picker: q }), queryFn: ({ signal }) => listAdminProducts({ ...(q ? { q } : {}), status: "active", limit: 8 }, { signal }), enabled: changing && !productId, staleTime: 30_000 });
  const product = useQuery({ queryKey: adminKeys.detail("products", productId ?? "none"), queryFn: ({ signal }) => getAdminProduct(productId!, { signal }), enabled: !!productId, staleTime: 30_000 });

  if (!changing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-surface-tint px-4 py-3">
        <span className="flex flex-col leading-[1.3]"><span className="text-caption text-muted">The gift</span><span className="font-bold">{label}</span>{priceMinor ? <span className="text-caption text-muted">Worth {formatNaira(priceMinor)} each. Customers pay nothing for it.</span> : null}</span>
        <Button size="sm" variant="outline" onClick={() => setChanging(true)}>Change gift</Button>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Choose the gift" className="flex flex-col gap-2 rounded-[16px] border border-line p-3.5">
      {!productId ? (
        <>
          <TextField size="admin" label="Find the product to give away" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" hint="Only products on sale can be given." error={error} />
          {results.isError ? <p role="alert" className="text-body-sm text-danger">{adminErrorMessage(results.error)}</p> : (
            <ul className="flex flex-col gap-1.5">
              {results.data?.data.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-subtle px-3 py-2"><span className="min-w-0 truncate">{p.title}</span><Button size="sm" variant="outline" onClick={() => setProductId(p.id)}>Choose<span className="sr-only"> {p.title}</span></Button></li>)}
              {results.data && results.data.data.length === 0 ? <li className="text-body-sm text-muted">No products match.</li> : null}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="font-bold">{product.data?.data.product.title ?? "Loading…"}</p>
          <p className="text-caption text-muted">Which one is given away?</p>
          {product.isError ? <p role="alert" className="text-body-sm text-danger">{adminErrorMessage(product.error)}</p> : (
            <ul className="flex flex-col gap-1.5">
              {product.data?.data.variants.filter((v) => v.active).map((v) => {
                const options = Object.values(v.optionValues).join(" · ");
                return (
                  <li key={v.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-subtle px-3 py-2">
                    <span className="flex min-w-0 flex-col leading-[1.3]"><span className="truncate font-semibold">{options || v.sku}</span><span className="text-caption text-muted">{v.sku} · {formatNaira(v.priceMinor)} · {v.stock.available} in stock</span></span>
                    <Button size="sm" variant="outline" onClick={() => { onPick({ variantId: v.id, label: `${product.data!.data.product.title}${options ? ` (${options})` : ""}`, priceMinor: v.priceMinor }); setChanging(false); setProductId(null); }}>Give this<span className="sr-only"> {options || v.sku}</span></Button>
                  </li>
                );
              })}
              {product.data && product.data.data.variants.filter((v) => v.active).length === 0 ? <li className="text-body-sm text-muted">This product has no active variants.</li> : null}
            </ul>
          )}
          <Button size="sm" variant="ghost-link" className="self-start" onClick={() => setProductId(null)}>Back to search</Button>
        </>
      )}
    </div>
  );
}
