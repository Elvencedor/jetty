import { cacheLife, cacheTag } from "next/cache";
import { isApiError } from "@/lib/api/client";
import { getCategories, getListing, getProduct, getReviews, getScopedFacets, type ListParams, type ListScope } from "@/lib/api/catalog";
import type { CategoryNode } from "@/lib/api/types";
import { getHome, getStoreSettings } from "@/lib/api/content";

/**
 * Server-side reads, cached for a few minutes (the API changes slowly and the storefront must stay fast when it
 * does not). Callers must run `await connection()` in an uncached parent first, so a build never calls the API.
 * Arguments are part of the cache key, so the same filters share one entry.
 */

export async function getHomeCached() {
  "use cache";
  cacheLife("minutes");
  cacheTag("home");
  return getHome();
}

export async function getSettingsCached() {
  "use cache";
  cacheLife("hours");
  cacheTag("settings");
  return getStoreSettings();
}

export async function getCategoriesCached() {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  return getCategories();
}

export async function getListingCached(scope: ListScope | undefined, params: ListParams) {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  return getListing(scope, params);
}

export async function getFacetsCached(scope: ListScope | undefined, params: Omit<ListParams, "sort" | "limit" | "cursor">) {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  return getScopedFacets(scope, params);
}

const flatten = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

/** Whether a slug names a category or a collection, and its display name. Null if it names neither. */
export async function resolveScope(slug: string): Promise<(ListScope & { name: string }) | null> {
  const tree = await getCategoriesCached();
  const category = flatten(tree.categories).find((c) => c.slug === slug);
  if (category) return { kind: "category", slug, name: category.name };
  const collection = tree.collections.find((c) => c.slug === slug);
  return collection ? { kind: "collection", slug, name: collection.name } : null;
}

/** The product, or null if there is no such product. A missing product is an answer, not a failure, so it is cached too. */
export async function getProductCached(slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog", `product:${slug}`);
  try {
    return await getProduct(slug);
  } catch (err) {
    if (isApiError(err) && err.status === 404) return null;
    throw err;
  }
}

export async function getReviewsCached(productId: string, rating: number | undefined) {
  "use cache";
  cacheLife("minutes");
  cacheTag("reviews", `reviews:${productId}`);
  return getReviews(productId, { ...(rating ? { rating } : {}), limit: 5 });
}
