import { connection } from "next/server";
import type { ListScope } from "@/lib/api/catalog";
import { Listing } from "./Listing";
import { getFacetsCached, getListingCached } from "@/lib/catalog/data";
import { reportError } from "@/lib/monitoring";
import { toApiParams, toSearchParams, type ListState } from "@/lib/catalog/params";
import { Button, EmptyState } from "@/components/ui";

/** Fetches a listing's first page and facets, then hands them to the interactive `Listing`. */
export async function ListingPage({ path, scope, state }: { path: string; scope?: ListScope; state: ListState }) {
  await connection();
  const params = toApiParams(state, { limit: 20 });
  const { sort: _sort, limit: _limit, cursor: _cursor, ...facetParams } = params;
  const [page, facets] = await Promise.all([
    getListingCached(scope, params),
    getFacetsCached(scope, facetParams).catch((err) => (reportError(err, { source: "facets" }), null)),
  ]).catch((err) => {
    reportError(err, { source: "listing", path });
    return [null, null] as const;
  });
  if (!page) {
    return (
      <EmptyState title="We couldn't load the wigs" action={<Button href={path}>Try again</Button>}>
        Something went wrong on our side. Please try again in a moment.
      </EmptyState>
    );
  }
  // A new query is a new component, so appended pages from the old one are discarded.
  return <Listing key={toSearchParams(state).toString()} path={path} scope={scope} state={state} initial={{ items: page.data, nextCursor: page.page.nextCursor, total: page.page.total ?? null }} facets={facets} />;
}
