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
      <EmptyState title="What are you looking for?" action={<Button href="/shop">Browse all wigs</Button>}>
        Search by style, texture or length, for example &ldquo;bob&rdquo; or &ldquo;26 inch&rdquo;.
      </EmptyState>
    );
  }
  return (
    <>
      <h1 className="font-display text-heading-lg font-extrabold">Results for &ldquo;{state.q}&rdquo;</h1>
      <ListingPage path="/search" state={state} />
    </>
  );
}

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <div className="mx-auto flex w-full max-w-store flex-col gap-4 px-4 pt-4">
      <Suspense fallback={<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
