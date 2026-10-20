"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Chip, Sheet, Switch } from "@/components/ui";
import { getListing, getScopedFacets, type ListScope } from "@/lib/api/catalog";
import { FACET_OPTIONS, type FacetOption, type Facets } from "@/lib/api/types";
import { clearFilters, toApiParams, type ListState } from "@/lib/catalog/params";

const TITLES: Record<FacetOption, string> = { texture: "Texture", lace: "Lace", length: "Length", density: "Density", colour: "Colour" };

type Props = {
  open: boolean;
  onClose: () => void;
  /** The applied state; the sheet edits a copy until "Show" is pressed. */
  state: ListState;
  scope?: ListScope;
  facets: Facets | null;
  onApply: (next: ListState) => void;
};

/** Filters in a sheet (phone) or drawer (wider). Facet counts and the "Show N" total follow the draft selection. */
export function FilterSheet({ open, onClose, state, scope, facets: initial, onApply }: Props) {
  // The sheet renders its content only while open, so each opening starts from the applied filters.
  return (
    <Sheet open={open} onClose={onClose} title="Filters">
      <Body state={state} scope={scope} initial={initial} onClose={onClose} onApply={onApply} />
    </Sheet>
  );
}

function Body({ state, scope, initial, onClose, onApply }: { state: ListState; scope?: ListScope; initial: Facets | null; onClose: () => void; onApply: (next: ListState) => void }) {
  const [draft, setDraft] = useState(state);
  const [minText, setMinText] = useState(draft.minPriceNaira?.toString() ?? "");
  const [maxText, setMaxText] = useState(draft.maxPriceNaira?.toString() ?? "");

  const filters = toApiParams(draft);
  const { sort: _sort, ...facetParams } = filters;
  // Until the draft changes, the server's facets already answer the question: no request on opening.
  const untouched = draft === state;
  const { data: facets = initial } = useQuery({
    queryKey: ["facets", scope ?? null, facetParams],
    queryFn: ({ signal }) => getScopedFacets(scope, facetParams, { signal }),
    placeholderData: keepPreviousData,
    ...(untouched && initial ? { initialData: initial } : {}),
    staleTime: 30_000,
  });
  const { data: count } = useQuery({
    queryKey: ["listing-total", scope ?? null, facetParams],
    queryFn: ({ signal }) => getListing(scope, { ...facetParams, limit: 1 }, { signal }).then((r) => r.page.total ?? null),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const toggle = (name: FacetOption, key: string) =>
    setDraft((d) => {
      const current = d.options[name] ?? [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      const options = { ...d.options, [name]: next };
      if (!next.length) delete options[name];
      return { ...d, options };
    });

  /** The draft with the typed price range folded in (swapped if entered backwards). */
  const withPrice = (d: ListState): ListState => {
    const parse = (t: string) => (/^\d{1,9}$/.test(t.trim()) ? Number(t) : undefined);
    let min = parse(minText);
    let max = parse(maxText);
    if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
    const { minPriceNaira: _a, maxPriceNaira: _b, ...rest } = d;
    return { ...rest, ...(min !== undefined ? { minPriceNaira: min } : {}), ...(max !== undefined ? { maxPriceNaira: max } : {}) };
  };
  const commitPrice = () => setDraft(withPrice);

  return (
    <>
      <div className="flex flex-col gap-6">
        {FACET_OPTIONS.map((name) => {
          const values = facets?.options[name] ?? [];
          if (!values.length) return null;
          return (
            <fieldset key={name} className="flex flex-col gap-2">
              <legend className="mb-2 text-label font-bold">{TITLES[name]}</legend>
              <div className="flex flex-wrap gap-2">
                {values.map((v) => {
                  const selected = draft.options[name]?.includes(v.valueKey) ?? false;
                  return (
                    <Chip key={v.valueKey} selected={selected} aria-pressed={selected} disabled={v.count === 0 && !selected} onClick={() => toggle(name, v.valueKey)}>
                      {name === "colour" && v.swatch ? <span aria-hidden="true" className="size-3.5 rounded-full border border-white shadow-swatch-inset" style={{ background: v.swatch }} /> : null}
                      {name === "length" ? `${v.label}"` : v.label} <span className="text-muted">({v.count})</span>
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-label font-bold">Price (₦)</legend>
          <div className="flex items-center gap-2">
            <input aria-label="Minimum price in naira" inputMode="numeric" placeholder={facets?.price ? String(Math.floor(facets.price.minMinor / 100)) : "Min"} value={minText} onChange={(e) => setMinText(e.target.value.replace(/\D/g, ""))} onBlur={commitPrice} className="h-11 w-full min-w-0 rounded-pill border border-line-strong px-4 text-body-sm" />
            <span aria-hidden="true" className="text-muted">to</span>
            <input aria-label="Maximum price in naira" inputMode="numeric" placeholder={facets?.price ? String(Math.ceil(facets.price.maxMinor / 100)) : "Max"} value={maxText} onChange={(e) => setMaxText(e.target.value.replace(/\D/g, ""))} onBlur={commitPrice} className="h-11 w-full min-w-0 rounded-pill border border-line-strong px-4 text-body-sm" />
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-body-sm font-semibold">
            <span>In stock only{facets ? <span className="font-normal text-muted"> ({facets.inStockCount})</span> : null}</span>
            <Switch label="In stock only" checked={draft.inStock} onChange={(inStock) => setDraft((d) => ({ ...d, inStock }))} />
          </label>
          <label className="flex items-center justify-between gap-3 text-body-sm font-semibold">
            <span>On offer{facets ? <span className="font-normal text-muted"> ({facets.onOfferCount})</span> : null}</span>
            <Switch label="On offer" checked={draft.onOffer} onChange={(onOffer) => setDraft((d) => ({ ...d, onOffer }))} />
          </label>
        </div>
      </div>

      <div className="sticky -bottom-4 -mx-5 mt-6 flex gap-3 border-t border-line bg-surface px-5 py-3">
        <Button variant="outline" onClick={() => { const cleared = clearFilters(draft); setDraft(cleared); setMinText(""); setMaxText(""); }}>
          Reset
        </Button>
        <Button
          fullWidth
          onClick={() => {
            onApply(withPrice(draft));
            onClose();
          }}
          aria-live="polite"
        >
          {count === undefined || count === null ? "Show wigs" : `Show ${count} ${count === 1 ? "wig" : "wigs"}`}
        </Button>
      </div>
    </>
  );
}
