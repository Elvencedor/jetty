import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getSitemapData } from "@/lib/catalog/data";
import { absoluteUrl } from "@/lib/site";

/** Every page worth finding in a search: home, the shop, each category and collection, each product, the published info pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const data = await getSitemapData();
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/shop"), changeFrequency: "daily", priority: 0.9 },
    ...[...data.categories, ...data.collections].map((slug) => ({ url: absoluteUrl(`/shop/${slug}`), changeFrequency: "weekly" as const, priority: 0.7 })),
    ...data.products.map((slug) => ({ url: absoluteUrl(`/p/${slug}`), changeFrequency: "weekly" as const, priority: 0.8 })),
    ...data.pages.map((p) => ({ url: absoluteUrl(`/pages/${p.slug}`), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.4 })),
  ];
}
