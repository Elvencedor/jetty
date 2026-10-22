import { cacheLife, cacheTag } from "next/cache";
import { isApiError } from "@/lib/api/client";
import { getCategories, getListing, getProduct, getProducts, getReviews, getScopedFacets, type ListParams, type ListScope } from "@/lib/api/catalog";
import type { CategoryNode } from "@/lib/api/types";
import { getHome, getPage, getStoreSettings } from "@/lib/api/content";

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

/** A published static page, or null if there is none (a missing page is an answer, so it is cached too). */
export async function getPageCached(slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("pages", `page:${slug}`);
  try {
    return await getPage(slug);
  } catch (err) {
    if (isApiError(err) && err.status === 404) return null;
    throw err;
  }
}

/** Static pages worth listing in the sitemap; only the ones that are published end up there. */
export const KNOWN_PAGES = ["returns", "delivery", "faqs", "size-guide", "care-guide", "contact", "terms", "privacy"] as const;

/** Product pages are listed a hundred at a time; this caps a runaway catalogue (and the API calls to build one sitemap). */
const SITEMAP_MAX_PRODUCTS = 5000;

/** Everything the sitemap lists, gathered in one cached pass (an hour is plenty for a sitemap). */
export async function getSitemapData() {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", "pages");
  const slugs: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await getProducts({ limit: 100, ...(cursor ? { cursor } : {}) });
    slugs.push(...page.data.map((p) => p.slug));
    cursor = page.page.nextCursor ?? undefined;
  } while (cursor && slugs.length < SITEMAP_MAX_PRODUCTS);

  const tree = await getCategories();
  const pages = (await Promise.all(KNOWN_PAGES.map((slug) => getPageCached(slug).catch(() => null)))).flatMap((p) => (p ? [{ slug: p.slug, updatedAt: p.updatedAt }] : []));
  return {
    products: slugs,
    categories: flatten(tree.categories).map((c) => c.slug),
    collections: tree.collections.map((c) => c.slug),
    pages,
  };
}
