import type { Metadata } from "next";
import { Suspense } from "react";
import { ListingPage } from "@/components/catalog/ListingPage";
import { ProductCardSkeleton } from "@/components/commerce/ProductCard";
import { Button, EmptyState } from "@/components/ui";
import { parseListState } from "@/lib/catalog/params";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

async function Content({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const state = parseListState(await searchParams);
  if (!state.q) {
    return (
      <EmptyState className="mx-4 mt-4" title="What are you looking for?" action={<Button href="/shop">Browse all wigs</Button>}>
        Search by style, texture or length, for example &ldquo;bob&rdquo; or &ldquo;26 inch&rdquo;.
      </EmptyState>
    );
  }
  return <ListingPage path="/search" title={`“${state.q}”`} crumbs={["Search"]} state={state} />;
}

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <div className="flex w-full flex-col">
      <Suspense fallback={<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
