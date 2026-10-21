"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ProductCard, ProductCardSkeleton } from "@/components/commerce/ProductCard";
import { BackLink } from "@/components/shell/BackLink";
import { BagLink } from "@/components/shell/BagLink";
import { SearchBox } from "@/components/shell/SearchBox";
import { Button, Chip, EmptyState } from "@/components/ui";
import { getListing, getProducts, type ListScope } from "@/lib/api/catalog";
import { type FacetOption, type Facets, type ProductCard as Card, type ProductSort } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { activeFilters, clearFilters, countActiveFilters, hrefFor, SORTS, toApiParams, type ListState, type ListView } from "@/lib/catalog/params";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { useUiPrefs } from "@/lib/stores/ui-prefs";
import { FilterSheet } from "./FilterSheet";

type Props = {
  title: string;
  /** Path segments for the breadcrumb after "Home", the last being the current page. */
  crumbs: string[];
  /** Route the listing lives at, e.g. "/shop" or "/shop/frontal-wigs". */
  path: string;
  scope?: ListScope;
  state: ListState;
  initial: { items: Card[]; nextCursor: string | null; total: number | null };
  facets: Facets | null;
};

const PAGE = 20;
/** The facet groups that get a pill of their own in the row under the header. */
const PILLS: { key: FacetOption | "price"; label: string }[] = [
  { key: "texture", label: "Texture" },
  { key: "lace", label: "Lace" },
  { key: "length", label: "Length" },
  { key: "price", label: "Price" },
];

/**
 * The interactive part of a listing. Everything shown is derived from the URL (`state`), so reloads, back/forward and
 * shared links all agree; this component only turns taps into new URLs. The server page re-keys it per query, so
 * appended pages never leak between different filters.
 */
export function Listing({ title, crumbs, path, scope, state, initial, facets }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [sheet, setSheet] = useState<{ open: boolean; focus?: FacetOption | "price" }>({ open: false });
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
      const page = await getListing(scope, toApiParams(state, { limit: PAGE, cursor }));
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        firstNew.current = prev.length;
        return [...prev, ...page.data.filter((p) => !seen.has(p.id))];
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
  const remaining = total !== null ? Math.max(total - items.length, 0) : null;
  const setView = (view: ListView) => {
    useUiPrefs.getState().setListView(view);
    go({ ...state, view });
  };
  const pillActive = (key: FacetOption | "price") => (key === "price" ? state.minPriceNaira !== undefined || state.maxPriceNaira !== undefined : (state.options[key]?.length ?? 0) > 0);
  const open = (focus?: FacetOption | "price") => setSheet({ open: true, ...(focus ? { focus } : {}) });
  const viewButton = (view: ListView, Icon: typeof List, label: string) => (
    <button type="button" aria-label={label} aria-pressed={state.view === view} onClick={() => setView(view)} className={cn("flex h-9 w-10 items-center justify-center rounded-pill", state.view === view ? "bg-primary text-on-primary" : "text-ink")}>
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
    </button>
  );

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-3 rounded-b-xl bg-surface-tint px-4 pb-[18px] pt-2.5">
        <div className="flex items-center justify-between lg:hidden">
          <BackLink fallback="/" />
          <Crumbs crumbs={crumbs} />
          <BagLink className="bg-surface" ring="ring-pink-100" />
        </div>
        <div className="hidden lg:block"><Crumbs crumbs={crumbs} /></div>
        <div className="flex items-end justify-between gap-3">
          <h1 className="font-display text-display-md font-extrabold">{title}</h1>
          <div role="group" aria-label="View" className="flex shrink-0 rounded-pill bg-surface p-1">
            {viewButton("grid", LayoutGrid, "Grid view")}
            {viewButton("list", List, "List view")}
          </div>
        </div>
        <SearchBox size="md" tone="white" className="[&_form]:h-12" scopePath={path} initial={state.q ?? ""} placeholder={`Search in ${title}`} label={`Search in ${title}`} />
      </header>

      <div className="mx-auto w-full max-w-store">
        <div className="flex gap-2 overflow-x-auto px-4 pb-1.5 pt-3.5 [scrollbar-width:none]">
          <button type="button" onClick={() => open()} className="flex h-10 shrink-0 items-center gap-1.5 rounded-pill bg-surface-inverse px-3.5 text-body-sm font-semibold text-on-inverse">
            <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={2} />
            All filters{filterCount ? ` · ${filterCount}` : ""}
          </button>
          {PILLS.map((p) => (
            <button key={p.key} type="button" onClick={() => open(p.key)} className={cn("flex h-10 shrink-0 items-center gap-1 rounded-pill border-[1.5px] pl-3.5 pr-3 text-body-sm font-semibold", pillActive(p.key) ? "border-primary bg-surface-tint text-primary-strong" : "border-line-strong bg-surface text-ink")}>
              {p.label}
              <ChevronDown aria-hidden="true" size={14} strokeWidth={2.2} />
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 pb-2.5 pt-1.5 text-label text-muted">
          <p role="status">{total !== null ? <><strong className="text-ink">{total}</strong> {total === 1 ? "wig" : "wigs"}</> : `${items.length} shown`}</p>
          <label className="flex items-center gap-1">
            Sort
            <select value={state.sort} onChange={(e) => go({ ...state, sort: e.target.value as ProductSort })} className="h-9 border-0 bg-transparent font-bold text-ink">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <div className="px-4">
          {items.length === 0 ? (
            <Empty state={state} chips={chips} filterCount={filterCount} onClear={() => go(clearFilters(state))} onRemove={go} />
          ) : (
            <div ref={grid} aria-busy={pending} className={cn("transition-opacity", pending && "opacity-50", state.view === "list" ? "flex flex-col gap-2.5" : "grid grid-cols-2 gap-x-2.5 gap-y-3.5 md:grid-cols-3 lg:grid-cols-4")}>
              {items.map((p, i) => <ProductCard key={p.id} product={p} layout={state.view} tone={i} priority={i < 2} heading="h2" />)}
              {more === "loading" ? Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={`s${i}`} layout={state.view} />) : null}
            </div>
          )}

          {items.length > 0 ? (
            <div className="flex flex-col items-center gap-2 py-[22px]">
              {more === "error" ? <p role="alert" className="text-body-sm text-danger">We couldn&apos;t load more wigs.</p> : null}
              {cursor ? (
                <Button variant="outline" size="lg" onClick={showMore} loading={more === "loading"}>{more === "error" ? "Try again" : remaining ? `Show more (${remaining})` : "Show more"}</Button>
              ) : items.length > PAGE ? (
                <p className="text-body-sm text-muted">That&apos;s everything</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <FilterSheet open={sheet.open} onClose={() => setSheet({ open: false })} state={state} scope={scope} facets={facets} {...(sheet.focus ? { focus: sheet.focus } : {})} onApply={go} />
    </div>
  );
}

function Crumbs({ crumbs }: { crumbs: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-label text-muted">
      <Link href="/" className="text-muted">Home</Link>
      {crumbs.map((c, i) => (
        <span key={c} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true">›</span>
          {i === crumbs.length - 1 ? <span aria-current="page" className="truncate font-semibold text-ink">{c}</span> : <span>{c}</span>}
        </span>
      ))}
    </nav>
  );
}

/** No matches: say so, show what is applied (each removable) and offer the best sellers instead of a dead end. */
function Empty({ state, chips, filterCount, onClear, onRemove }: { state: ListState; chips: ReturnType<typeof activeFilters>; filterCount: number; onClear: () => void; onRemove: (next: ListState) => void }) {
  const best = useQuery({ queryKey: ["best-sellers"], queryFn: ({ signal }) => getProducts({ sort: "bestSelling", limit: 4 }, { signal }), staleTime: 5 * 60_000 });
  return (
    <div className="flex flex-col gap-5">
      <EmptyState title={state.q ? `No results for “${state.q}”` : "No wigs match these filters"} action={filterCount ? <Button onClick={onClear}>Clear filters</Button> : <Button href="/shop">Browse all wigs</Button>}>
        {filterCount ? "Try removing a filter to see more." : "Check the spelling or try a broader search."}
      </EmptyState>
      {chips.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Applied filters">
          {chips.map((c) => <li key={c.key}><Chip variant="removable" onClick={() => onRemove(c.without)} aria-label={`Remove filter: ${c.label}`}>{c.label}</Chip></li>)}
        </ul>
      ) : null}
      {best.data?.data.length ? (
        <section aria-label="Best sellers" className="flex flex-col gap-3">
          <h2 className="font-display text-heading-sm font-extrabold">Best sellers</h2>
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5 md:grid-cols-4">
            {best.data.data.map((p, i) => <ProductCard key={p.id} product={p} tone={i} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}
