"use client";

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { useDebounced } from "@/components/shell/useDebounced";
import { Button, Skeleton, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { FEATURED_LIMIT, moveId } from "@/lib/admin/storefront";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";
import { getAdminProduct, listAdminProducts } from "@/lib/api/admin-catalog";
import { createContent, listContent, updateContent, type ContentEntry } from "@/lib/api/admin-content";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/stores/toast";

/** "Jetty's picks": either the products you choose, in the order you choose, or the ones marked featured in the catalogue. */
export function ProductsRow({ canWrite }: { canWrite: boolean }) {
  const key = adminKeys.list("content", { type: "featured_products" });
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => listContent({ type: "featured_products" }, { signal }), staleTime: 0 });
  if (list.isError && !list.data) return <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger"><span>{adminErrorMessage(list.error)}</span><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></div>;
  if (!list.data) return <Skeleton className="h-40" />;
  const entry = list.data.find((e) => e.status !== "archived") ?? null;
  return <Editor key={entry?.id ?? "none"} entry={entry} canWrite={canWrite} />;
}

function Editor({ entry, canWrite }: { entry: ContentEntry | null; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const initialIds = (entry?.body.productIds as string[] | undefined) ?? [];
  const initialHeading = (entry?.body.heading as string | undefined) ?? "";
  const [manual, setManual] = useState(!!entry && entry.status === "published");
  const [ids, setIds] = useState(initialIds);
  const [heading, setHeading] = useState(initialHeading);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const dirty = manual !== (!!entry && entry.status === "published") || heading !== initialHeading || JSON.stringify(ids) !== JSON.stringify(initialIds);
  useUnsavedGuard(dirty);

  const names = useQueries({ queries: ids.map((id) => ({ queryKey: adminKeys.detail("products", id), queryFn: ({ signal }: { signal: AbortSignal }) => getAdminProduct(id, { signal }), staleTime: 60_000 })) });
  const results = useQuery({ queryKey: adminKeys.list("products", { picker: q }), queryFn: ({ signal }) => listAdminProducts({ ...(q ? { q } : {}), status: "active", limit: 8 }, { signal }), enabled: manual && canWrite, staleTime: 30_000 });

  async function save() {
    setBusy(true);
    setProblem(undefined);
    try {
      if (!manual) {
        if (entry) await updateContent(entry.id, { status: "archived" });
      } else {
        const body = { ...(heading.trim() ? { heading: heading.trim() } : {}), productIds: ids };
        if (entry) await updateContent(entry.id, { title: heading.trim() || "Jetty's picks", body, status: "published" });
        else await createContent({ contentType: "featured_products", title: heading.trim() || "Jetty's picks", body, status: "published" });
      }
      toast.success("Saved. The home page row is updated.");
      void queryClient.invalidateQueries({ queryKey: adminKeys.resource("content") });
    } catch (err) {
      setProblem(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{problem}</p> : null}
      <div role="radiogroup" aria-label="Which products?" className="grid gap-2">
        {[{ on: true, label: "I will pick them", note: "Choose the products and their order." }, { on: false, label: "Products marked as featured", note: "Automatic: whatever is starred in the catalogue." }].map((o) => (
          <button key={String(o.on)} type="button" role="radio" aria-checked={manual === o.on} disabled={!canWrite} onClick={() => setManual(o.on)} className={cn("flex flex-col rounded-[16px] border-2 p-3 text-left disabled:opacity-60", manual === o.on ? "border-primary bg-surface-tint" : "border-line bg-surface")}>
            <span className="font-bold">{o.label}</span><span className="text-caption text-muted">{o.note}</span>
          </button>
        ))}
      </div>

      {manual ? (
        <>
          <TextField size="admin" label="Section title" value={heading} disabled={!canWrite} onChange={(e) => setHeading(e.target.value)} placeholder="Jetty's picks" />
          <section aria-label="Chosen products" className="flex flex-col gap-1.5">
            <h3 className="text-label font-semibold">Chosen products ({ids.length} of {FEATURED_LIMIT})</h3>
            {ids.length === 0 ? <p className="text-body-sm text-muted">None yet. The shop shows the featured products until you add some.</p> : (
              <ol className="flex flex-col gap-1.5">
                {ids.map((id, i) => {
                  const title = names[i]?.data?.data.product.title ?? "Loading…";
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-[12px] border border-line bg-surface px-3 py-2">
                      <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
                      {canWrite ? (
                        <>
                          <button type="button" aria-label={`Move ${title} earlier`} disabled={i === 0} onClick={() => setIds(moveId(ids, id, -1))} className="inline-flex size-8 items-center justify-center rounded-full bg-surface-tint disabled:opacity-40"><ArrowUp aria-hidden="true" size={14} /></button>
                          <button type="button" aria-label={`Move ${title} later`} disabled={i === ids.length - 1} onClick={() => setIds(moveId(ids, id, 1))} className="inline-flex size-8 items-center justify-center rounded-full bg-surface-tint disabled:opacity-40"><ArrowDown aria-hidden="true" size={14} /></button>
                          <button type="button" aria-label={`Remove ${title}`} onClick={() => setIds(ids.filter((x) => x !== id))} className="inline-flex size-8 items-center justify-center rounded-full bg-danger-bg text-danger"><X aria-hidden="true" size={14} /></button>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          {canWrite ? (
            <section aria-label="Pick products" className="flex flex-col gap-2">
              <TextField size="admin" label="Find a product" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
              {results.isError ? <p role="alert" className="text-body-sm text-danger">{adminErrorMessage(results.error)}</p> : (
                <ul className="flex flex-col gap-1.5">
                  {results.data?.data.map((p) => {
                    const added = ids.includes(p.id);
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-subtle px-3 py-2">
                        <span className="min-w-0 truncate">{p.title}</span>
                        <Button size="sm" variant="outline" disabled={added || ids.length >= FEATURED_LIMIT} onClick={() => setIds([...ids, p.id])}>{added ? "Added" : "Add"}<span className="sr-only"> {p.title}</span></Button>
                      </li>
                    );
                  })}
                  {results.data && results.data.data.length === 0 ? <li className="text-body-sm text-muted">No products match.</li> : null}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}
      {canWrite ? <div className="flex justify-end"><Button loading={busy} disabled={!dirty || busy} onClick={() => void save()}>Save and publish</Button></div> : null}
    </div>
  );
}
