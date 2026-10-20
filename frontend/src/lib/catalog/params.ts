import type { ListParams } from "@/lib/api/catalog";
import { FACET_OPTIONS, type FacetOption, type ProductSort } from "@/lib/api/types";

/**
 * The state of a product listing, held entirely in the URL so results can be shared and the back button works
 * (`?texture=body-wave&length=14,20&sort=priceAsc&view=list`). Prices in the URL are whole naira; the API takes kobo.
 */
export const SORTS: { value: ProductSort; label: string }[] = [
  { value: "recommended", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "priceAsc", label: "Price: low to high" },
  { value: "priceDesc", label: "Price: high to low" },
  { value: "topRated", label: "Top rated" },
  { value: "bestSelling", label: "Best selling" },
];

export type ListView = "grid" | "list";

export type ListState = {
  q?: string;
  options: Partial<Record<FacetOption, string[]>>;
  minPriceNaira?: number;
  maxPriceNaira?: number;
  inStock: boolean;
  onOffer: boolean;
  sort: ProductSort;
  view: ListView;
};

export const DEFAULT_SORT: ProductSort = "recommended";
export const PAGE_SIZE = 20;

export const emptyListState = (): ListState => ({ options: {}, inStock: false, onOffer: false, sort: DEFAULT_SORT, view: "grid" });

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const flag = (v: string | string[] | undefined) => ["1", "true"].includes(first(v) ?? "");
const naira = (v: string | string[] | undefined) => {
  const n = Number(first(v));
  return Number.isInteger(n) && n >= 0 && n <= 100_000_000 ? n : undefined;
};
const VALUE_KEY = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Reads a URL's query into listing state. Anything unrecognised or malformed is ignored rather than rejected. */
export function parseListState(raw: RawParams): ListState {
  const state = emptyListState();
  const q = first(raw.q)?.trim();
  if (q) state.q = q.slice(0, 100);

  for (const name of FACET_OPTIONS) {
    const keys = [...new Set(all(raw[name]).flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter((v) => VALUE_KEY.test(v)))].slice(0, 20);
    if (keys.length) state.options[name] = keys;
  }

  const min = naira(raw.minPrice);
  const max = naira(raw.maxPrice);
  // A reversed range is a mistake; keep the sensible end rather than showing nothing.
  if (min !== undefined && max !== undefined && min > max) state.minPriceNaira = max;
  else {
    if (min !== undefined) state.minPriceNaira = min;
    if (max !== undefined) state.maxPriceNaira = max;
  }
  state.inStock = flag(raw.inStock);
  state.onOffer = flag(raw.onOffer);

  const sort = first(raw.sort);
  if (SORTS.some((s) => s.value === sort)) state.sort = sort as ProductSort;
  if (first(raw.view) === "list") state.view = "list";
  return state;
}

/** The query string for a state. Defaults are left out so shared links stay short. */
export function toSearchParams(state: ListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  for (const name of FACET_OPTIONS) {
    const keys = state.options[name];
    if (keys?.length) params.set(name, keys.join(","));
  }
  if (state.minPriceNaira !== undefined) params.set("minPrice", String(state.minPriceNaira));
  if (state.maxPriceNaira !== undefined) params.set("maxPrice", String(state.maxPriceNaira));
  if (state.inStock) params.set("inStock", "1");
  if (state.onOffer) params.set("onOffer", "1");
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.view !== "grid") params.set("view", state.view);
  return params;
}

export const hrefFor = (path: string, state: ListState) => {
  const qs = toSearchParams(state).toString();
  return qs ? `${path}?${qs}` : path;
};

/** What to send to the API. Sort and view do not affect which products match, so facets and counts ignore them. */
export function toApiParams(state: ListState, extra: { limit?: number; cursor?: string } = {}): ListParams {
  return {
    ...(state.q ? { q: state.q } : {}),
    ...state.options,
    ...(state.minPriceNaira !== undefined ? { minPrice: state.minPriceNaira * 100 } : {}),
    ...(state.maxPriceNaira !== undefined ? { maxPrice: state.maxPriceNaira * 100 } : {}),
    ...(state.inStock ? { inStock: true } : {}),
    ...(state.onOffer ? { onOffer: true } : {}),
    sort: state.sort,
    ...extra,
  };
}

export type ActiveFilter = { key: string; label: string; without: ListState };

/** The applied filters as removable chips. `labels` maps option value keys to their display labels when known. */
export function activeFilters(state: ListState, labels: Partial<Record<FacetOption, Record<string, string>>> = {}): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const pretty = (key: string) => key.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  for (const name of FACET_OPTIONS) {
    for (const key of state.options[name] ?? []) {
      const remaining = (state.options[name] ?? []).filter((k) => k !== key);
      const options = { ...state.options, [name]: remaining };
      if (!remaining.length) delete options[name];
      out.push({ key: `${name}:${key}`, label: labels[name]?.[key] ?? (name === "length" ? `${key}"` : pretty(key)), without: { ...state, options } });
    }
  }
  if (state.minPriceNaira !== undefined || state.maxPriceNaira !== undefined) {
    const from = state.minPriceNaira !== undefined ? `₦${state.minPriceNaira.toLocaleString("en-NG")}` : "";
    const to = state.maxPriceNaira !== undefined ? `₦${state.maxPriceNaira.toLocaleString("en-NG")}` : "";
    const label = from && to ? `${from} – ${to}` : from ? `From ${from}` : `Up to ${to}`;
    const { minPriceNaira: _min, maxPriceNaira: _max, ...rest } = state;
    out.push({ key: "price", label, without: rest });
  }
  if (state.inStock) out.push({ key: "inStock", label: "In stock", without: { ...state, inStock: false } });
  if (state.onOffer) out.push({ key: "onOffer", label: "On offer", without: { ...state, onOffer: false } });
  return out;
}

/** Number shown on the "All filters" button. The search text and sort are not filters. */
export const countActiveFilters = (state: ListState) => activeFilters(state).length;

/** The state with every filter removed but the search text, sort and view kept. */
export const clearFilters = (state: ListState): ListState => ({ ...emptyListState(), ...(state.q ? { q: state.q } : {}), sort: state.sort, view: state.view });

/** The category or collection slug from the optional catch-all route segment, if it is a single valid slug. */
export function collectionFromSegments(segments: string[] | undefined): string | undefined {
  if (!segments || segments.length !== 1) return undefined;
  const slug = segments[0]!;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
}
