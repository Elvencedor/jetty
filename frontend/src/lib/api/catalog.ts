import { apiFetch, type RequestOptions } from "./client";
import type { CategoryTree, Facets, FacetOption, Paged, ProductCard, ProductDetail, ProductSort, ReviewList, ReviewSort, Suggestion } from "./types";

/** Listing filters. Option filters take value keys (`length: ["14", "20"]`). */
export type ListParams = {
  q?: string;
  category?: string;
  sort?: ProductSort;
  limit?: number;
  cursor?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onOffer?: boolean;
} & Partial<Record<FacetOption, string[]>>;

type Init = Pick<RequestOptions, "signal" | "next">;

export const getProducts = (params: ListParams = {}, init: Init = {}) => apiFetch<Paged<ProductCard>>("/products", { query: params, ...init });

export const getCollectionProducts = (slug: string, params: Omit<ListParams, "q" | "category"> = {}, init: Init = {}) =>
  apiFetch<Paged<ProductCard>>(`/collections/${encodeURIComponent(slug)}/products`, { query: params, ...init });

/** Filter options and counts for the current selection. Takes the listing filters, without sort, limit or cursor. */
export const getFacets = (params: Omit<ListParams, "sort" | "limit" | "cursor"> & { collection?: string } = {}, init: Init = {}) =>
  apiFetch<{ data: Facets }>("/products/facets", { query: params, ...init }).then((r) => r.data);

export const getProduct = (slug: string, init: Init = {}) => apiFetch<{ data: ProductDetail }>(`/products/${encodeURIComponent(slug)}`, init).then((r) => r.data);

export const getCategories = (init: Init = {}) => apiFetch<{ data: CategoryTree }>("/categories", init).then((r) => r.data);

export const getSuggestions = (q: string, init: Init = {}) => apiFetch<{ data: Suggestion[] }>("/products/suggestions", { query: { q }, ...init }).then((r) => r.data);

export const getReviews = (productId: string, params: { sort?: ReviewSort; rating?: number; limit?: number; cursor?: string } = {}, init: Init = {}) =>
  apiFetch<ReviewList>(`/products/${encodeURIComponent(productId)}/reviews`, { query: params, ...init });

/** What a listing is scoped to: a category (`/shop/frontal`) or a curated collection (`/shop/new-arrivals`). */
export type ListScope = { kind: "category" | "collection"; slug: string };

// Collections list their products as they are curated, so text search and category do not apply to them.
const withoutSearch = ({ q: _q, category: _category, ...rest }: ListParams) => rest;

/** One page of a listing, in whichever scope it lives in. */
export const getListing = (scope: ListScope | undefined, params: ListParams = {}, init: Init = {}) =>
  scope?.kind === "collection"
    ? getCollectionProducts(scope.slug, withoutSearch(params), init)
    : getProducts({ ...params, ...(scope ? { category: scope.slug } : {}) }, init);

/** Facets for a listing in its scope. */
export const getScopedFacets = (scope: ListScope | undefined, params: Omit<ListParams, "sort" | "limit" | "cursor"> = {}, init: Init = {}) =>
  getFacets({ ...params, ...(scope?.kind === "collection" ? { collection: scope.slug } : scope ? { category: scope.slug } : {}) }, init);
