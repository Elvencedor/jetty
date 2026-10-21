import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { InfoTabs } from "@/components/product/InfoTabs";
import { Markdown } from "@/components/product/Markdown";
import { ProductView } from "@/components/product/ProductView";
import { Reviews } from "@/components/product/Reviews";
import { Skeleton } from "@/components/ui";
import { getProductCached, getReviewsCached } from "@/lib/catalog/data";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug)) notFound();
  await connection();
  const product = await getProductCached(slug);
  if (!product) notFound();
  return product;
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await load(slug);
    const title = product.seo.title || product.title;
    const description = product.seo.description || product.description || undefined;
    const image = product.media.find((m) => m.isCover && m.url)?.url ?? product.media.find((m) => m.url)?.url;
    return { title, description, openGraph: { title, description, ...(image ? { images: [image] } : {}) } };
  } catch {
    return { title: "Product" };
  }
}

const TAB_LABELS = [["details", "Details"], ["fit", "Fit"], ["care", "Care"], ["delivery", "Delivery"]] as const;

async function Content({ params, searchParams }: Pick<PageProps<"/p/[slug]">, "params" | "searchParams">) {
  const { slug } = await params;
  const product = await load(slug);
  const rawRating = Number((await searchParams).rating);
  const rating = Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5 ? rawRating : undefined;
  const reviews = await getReviewsCached(product.id, rating).catch(() => null);

  const tabs = TAB_LABELS.flatMap(([key, label]) => (product.details[key] ? [{ key, label, content: <Markdown>{product.details[key]!}</Markdown> }] : []));
  const prices = product.variants.map((v) => v.price.amountMinor);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description ?? undefined,
    image: product.media.filter((m) => m.url).map((m) => m.url),
    ...(prices.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "NGN", lowPrice: Math.min(...prices) / 100, highPrice: Math.max(...prices) / 100, availability: product.variants.some((v) => v.availability.inStock) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } } : {}),
    ...(product.rating.count ? { aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating.average, reviewCount: product.rating.count } } : {}),
  };

  return (
    <>
      {/* "<" is escaped so product text can never close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ProductView product={product}>
        {!tabs.length && product.description ? <p className="text-body-sm text-ink-soft">{product.description}</p> : null}
        <InfoTabs tabs={tabs} />
        {reviews ? <Reviews productId={product.id} reviews={reviews} basePath={`/p/${slug}`} rating={rating} /> : null}
      </ProductView>
    </>
  );
}

export default function ProductPage(props: PageProps<"/p/[slug]">) {
  return (
    <div className="w-full">
      <Suspense fallback={<div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-[500px] rounded-none" /><Skeleton className="h-64" /></div>}>
        <Content params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
