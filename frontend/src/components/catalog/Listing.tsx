"use client";

import { LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ProductCard, ProductCardSkeleton } from "@/components/commerce/ProductCard";
import { Button, Chip, EmptyState } from "@/components/ui";
import { getListing, type ListScope } from "@/lib/api/catalog";
import type { Facets, ProductCard as Card, ProductSort } from "@/lib/api/types";
import { activeFilters, clearFilters, countActiveFilters, hrefFor, SORTS, toApiParams, type ListState, type ListView } from "@/lib/catalog/params";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { useUiPrefs } from "@/lib/stores/ui-prefs";
import { FilterSheet } from "./FilterSheet";

type Props = {
  /** Route the listing lives at, e.g. "/shop" or "/shop/frontal-wigs". */
  path: string;
  scope?: ListScope;
  state: ListState;
  initial: { items: Card[]; nextCursor: string | null; total: number | null };
  facets: Facets | null;
};

const PAGE = 20;

/**
 * The interactive part of a listing. Everything shown is derived from the URL (`state`), so reloads, back/forward and
 * shared links all agree; this component only turns taps into new URLs. The server page re-keys it per query, so
 * appended pages never leak between different filters.
 */
export function Listing({ path, scope, state, initial, facets }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [sheet, setSheet] = useState(false);
  const firstNew = useRef<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const go = (next: ListState) => startTransition(() => router.replace(hrefFor(path, next), { scroll: false }));

  // A saved list-view preference applies when the link itself does not say.
  const prefsReady = useStoreHydrated(useUiPrefs);
  const preferred = useUiPrefs((s) => s.listView);
  useEffect(() => {
    if (prefsReady && preferred === "list" && state.view === "grid" && !new URLSearchParams(window.location.search).has("view")) go({ ...state, view: "list" });
    // Runs once the preference is known; later changes come from the toggle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsReady]);

  // After "Show more", move focus to the first new card so keyboard and screen-reader users continue from there.
  useEffect(() => {
    if (firstNew.current === null) return;
    grid.current?.querySelectorAll<HTMLElement>("article a")[firstNew.current]?.focus({ preventScroll: false });
    firstNew.current = null;
  }, [items]);

  async function showMore() {
    if (!cursor || more === "loading") return;
    setMore("loading");
    try {
      const params = toApiParams(state, { limit: PAGE, cursor });
      const page = await getListing(scope, params);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const fresh = page.data.filter((p) => !seen.has(p.id));
        firstNew.current = prev.length;
        return [...prev, ...fresh];
      });
      setCursor(page.page.nextCursor);
      setMore("idle");
    } catch {
      setMore("error");
    }
  }

  const labels = useMemo(() => (facets ? Object.fromEntries(Object.entries(facets.options).map(([name, values]) => [name, Object.fromEntries(values.map((v) => [v.valueKey, name === "length" ? `${v.label}"` : v.label]))])) : {}), [facets]);
  const chips = activeFilters(state, labels);
  const filterCount = countActiveFilters(state);
  const total = initial.total;
  const setView = (view: ListView) => {
    useUiPrefs.getState().setListView(view);
    go({ ...state, view });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="dark" size="sm" iconLeft={<SlidersHorizontal aria-hidden="true" size={16} />} onClick={() => setSheet(true)}>
          Filters{filterCount ? ` (${filterCount})` : ""}
        </Button>
        <label className="flex items-center gap-2 text-label font-semibold">
          <span className="sr-only">Sort by</span>
          <select value={state.sort} onChange={(e) => go({ ...state, sort: e.target.value as ProductSort })} className="h-9 rounded-pill border border-line-strong bg-surface px-3 text-label font-semibold">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <div role="group" aria-label="Layout" className="ml-auto flex gap-1">
          <button type="button" aria-label="Grid view" aria-pressed={state.view === "grid"} onClick={() => setView("grid")} className={`inline-flex size-9 items-center justify-center rounded-full ${state.view === "grid" ? "bg-primary text-on-primary" : "bg-surface-tint"}`}><LayoutGrid aria-hidden="true" size={16} /></button>
          <button type="button" aria-label="List view" aria-pressed={state.view === "list"} onClick={() => setView("list")} className={`inline-flex size-9 items-center justify-center rounded-full ${state.view === "list" ? "bg-primary text-on-primary" : "bg-surface-tint"}`}><List aria-hidden="true" size={16} /></button>
        </div>
      </div>

      {chips.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Applied filters">
          {chips.map((c) => (
            <li key={c.key}><Chip variant="removable" onClick={() => go(c.without)} aria-label={`Remove filter: ${c.label}`}>{c.label}</Chip></li>
          ))}
          <li><Button variant="ghost-link" size="sm" onClick={() => go(clearFilters(state))}>Clear all</Button></li>
        </ul>
      ) : null}

      <p role="status" className="text-label text-muted">
        {total !== null ? `${total} ${total === 1 ? "wig" : "wigs"}` : `${items.length} shown`}
      </p>

      {items.length === 0 ? (
        <EmptyState title="No wigs match" action={filterCount ? <Button onClick={() => go(clearFilters(state))}>Clear filters</Button> : <Button href="/shop">Browse all wigs</Button>}>
          {filterCount ? "Try removing a filter to see more." : "Check the spelling or try a broader search."}
        </EmptyState>
      ) : (
        <div ref={grid} aria-busy={pending} className={`${pending ? "opacity-60" : ""} ${state.view === "list" ? "flex flex-col gap-3" : "grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 lg:grid-cols-4"}`}>
          {items.map((p, i) => (
            <ProductCard key={p.id} product={p} layout={state.view} tone={i} priority={i < 2} heading="h2" />
          ))}
          {more === "loading" ? Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={`s${i}`} layout={state.view} />) : null}
        </div>
      )}

      {cursor ? (
        <div className="flex flex-col items-center gap-2 pt-2">
          {more === "error" ? <p role="alert" className="text-body-sm text-danger">We couldn&apos;t load more wigs.</p> : null}
          <Button variant="outline" onClick={showMore} loading={more === "loading"}>{more === "error" ? "Try again" : "Show more"}</Button>
        </div>
      ) : null}

      <FilterSheet open={sheet} onClose={() => setSheet(false)} state={state} scope={scope} facets={facets} onApply={go} />
    </div>
  );
}
