import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ListingPage } from "@/components/catalog/ListingPage";
import { ProductCardSkeleton } from "@/components/commerce/ProductCard";
import { resolveScope } from "@/lib/catalog/data";
import { collectionFromSegments, parseListState } from "@/lib/catalog/params";

export async function generateMetadata({ params }: PageProps<"/shop/[[...collection]]">): Promise<Metadata> {
  const { collection } = await params;
  const slug = collectionFromSegments(collection);
  // Connection first, so the build never calls the API; a missing or failing lookup falls back to a plain title.
  await connection();
  const scope = slug ? await resolveScope(slug).catch(() => null) : null;
  const name = scope?.name ?? "All wigs";
  return { title: name, description: `Shop ${name.toLowerCase()} at Jetty's Hair.` };
}

function Fallback() {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
}

async function Content({ params, searchParams }: Pick<PageProps<"/shop/[[...collection]]">, "params" | "searchParams">) {
  const { collection: segments } = await params;
  const slug = collectionFromSegments(segments);
  if (segments?.length && !slug) notFound();
  await connection();
  const scope = slug ? await resolveScope(slug) : null;
  if (slug && !scope) notFound();
  const state = parseListState(await searchParams);
  return (
    <>
      <h1 className="font-display text-heading-lg font-extrabold">{scope?.name ?? "All wigs"}</h1>
      <ListingPage path={scope ? `/shop/${scope.slug}` : "/shop"} scope={scope ? { kind: scope.kind, slug: scope.slug } : undefined} state={state} />
    </>
  );
}

export default function ShopPage(props: PageProps<"/shop/[[...collection]]">) {
  return (
    <div className="mx-auto flex w-full max-w-store flex-col gap-4 px-4 pt-4">
      <Suspense fallback={<Fallback />}>
        <Content params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
