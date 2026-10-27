"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useDebounced } from "@/components/shell/useDebounced";
import { Button, Sheet, Spinner, Switch } from "@/components/ui";
import { getListing, getScopedFacets, type ListScope } from "@/lib/api/catalog";
import { FACET_OPTIONS, type FacetOption, type Facets } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { clearFilters, lengthText, toApiParams, type ListState } from "@/lib/catalog/params";
import { PriceRange } from "./PriceRange";

const TITLES: Record<FacetOption, string> = { texture: "Texture", lace: "Lace", length: "Length", density: "Density", colour: "Colour" };
/** The pause after the last change before the count is asked for again. */
const COUNT_DEBOUNCE_MS = 250;

type Props = {
  open: boolean;
  onClose: () => void;
  /** The applied state; the sheet edits a copy until "Show" is pressed. */
  state: ListState;
  scope?: ListScope;
  facets: Facets | null;
  /** Which group to bring into view on opening (from the pill that was tapped). */
  focus?: FacetOption | "price";
  onApply: (next: ListState) => void;
};

/** Filters in a sheet (phone) or drawer (wider). Facet counts and the "Show N" total follow the draft selection. */
export function FilterSheet({ open, onClose, state, scope, facets: initial, focus, onApply }: Props) {
  // The sheet renders its content only while open, so each opening starts from the applied filters.
  return (
    <Sheet open={open} onClose={onClose} title="Filters">
      <Body state={state} scope={scope} initial={initial} focus={focus} onClose={onClose} onApply={onApply} />
    </Sheet>
  );
}

function Body({ state, scope, initial, focus, onClose, onApply }: { state: ListState; scope?: ListScope; initial: Facets | null; focus?: Props["focus"]; onClose: () => void; onApply: (next: ListState) => void }) {
  const [draft, setDraft] = useState(state);

  useEffect(() => {
    if (focus) document.getElementById(`facet-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus]);

  // Stable between renders (it feeds a debounce and query keys), changing only when the draft does.
  const facetParams = useMemo(() => {
    const { sort: _sort, ...rest } = toApiParams(draft);
    return rest;
  }, [draft]);
  // Counts follow the draft, a beat after the last change so a run of taps asks once.
  const settled = useDebounced(facetParams, COUNT_DEBOUNCE_MS);
  const counting = settled !== facetParams;

  // Until the draft changes, the server's facets already answer the question: no request on opening.
  const untouched = draft === state;
  const { data: facets = initial } = useQuery({
    queryKey: ["facets", scope ?? null, settled],
    queryFn: ({ signal }) => getScopedFacets(scope, settled, { signal }),
    placeholderData: keepPreviousData,
    ...(untouched && initial ? { initialData: initial } : {}),
    staleTime: 30_000,
  });
  const { data: count, isFetching } = useQuery({
    queryKey: ["listing-total", scope ?? null, settled],
    queryFn: ({ signal }) => getListing(scope, { ...settled, limit: 1 }, { signal }).then((r) => r.page.total ?? null),
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

  const priceBounds = facets?.price ? { min: Math.floor(facets.price.minMinor / 100), max: Math.ceil(facets.price.maxMinor / 100) } : null;
  const busy = counting || isFetching;

  return (
    <>
      <div className="flex flex-col gap-5">
        {FACET_OPTIONS.map((name) => {
          const values = facets?.options[name] ?? [];
          if (!values.length) return null;
          if (name === "colour") {
            return (
              <fieldset key={name} id="facet-colour" className="flex flex-col gap-2.5 scroll-mt-2">
                <legend className="pb-2.5 font-bold">{TITLES[name]}</legend>
                <div className="flex flex-wrap gap-3">
                  {values.map((v) => {
                    const selected = draft.options.colour?.includes(v.valueKey) ?? false;
                    return (
                      <button key={v.valueKey} type="button" aria-pressed={selected} aria-label={v.label} disabled={v.count === 0 && !selected} onClick={() => toggle("colour", v.valueKey)} className="flex flex-col items-center gap-1 text-micro disabled:opacity-40">
                        <span className={cn("block size-10 rounded-full border border-black/10", selected && "outline-2 outline-offset-[3px] outline-primary")} style={{ background: v.swatch ?? "var(--color-line-strong)" }} />
                        <span aria-hidden="true">{v.label}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          }
          return (
            <fieldset key={name} id={`facet-${name}`} className="flex flex-col gap-2.5 scroll-mt-2">
              <legend className="pb-2.5 font-bold">{TITLES[name]}</legend>
              <div className="flex flex-wrap gap-2">
                {values.map((v) => {
                  const selected = draft.options[name]?.includes(v.valueKey) ?? false;
                  return (
                    <button
                      key={v.valueKey}
                      type="button"
                      aria-pressed={selected}
                      disabled={v.count === 0 && !selected}
                      onClick={() => toggle(name, v.valueKey)}
                      className={cn("min-h-10 rounded-pill border-[1.5px] px-3.5 text-body-sm font-semibold transition-colors duration-(--duration-base) disabled:opacity-40", selected ? "border-primary bg-surface-tint text-primary-strong" : "border-line-strong bg-surface text-ink")}
                    >
                      {name === "length" ? lengthText(v.label) : v.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        {priceBounds && priceBounds.max > priceBounds.min ? (
          <div id="facet-price" className="scroll-mt-2">
            <PriceRange min={priceBounds.min} max={priceBounds.max} from={draft.minPriceNaira} to={draft.maxPriceNaira} onChange={({ from, to }) => setDraft((d) => {
              const { minPriceNaira: _a, maxPriceNaira: _b, ...rest } = d;
              return { ...rest, ...(from !== undefined ? { minPriceNaira: from } : {}), ...(to !== undefined ? { maxPriceNaira: to } : {}) };
            })} />
          </div>
        ) : null}

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

      <div className="sticky -bottom-4 -mx-5 mt-6 flex gap-2.5 bg-surface px-5 pb-1 pt-3">
        <Button variant="outline" size="lg" className="h-[52px] flex-1 text-body-sm" onClick={() => setDraft(clearFilters(draft))}>
          Reset
        </Button>
        <Button
          size="lg"
          className="h-[52px] flex-[2] text-body-sm"
          aria-busy={busy}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          {busy ? <Spinner /> : null}
          <span aria-live="polite">{count === undefined || count === null ? "Show wigs" : `Show ${count} ${count === 1 ? "wig" : "wigs"}`}</span>
        </Button>
      </div>
    </>
  );
}
