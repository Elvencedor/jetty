"use client";

import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { PageHeader } from "../PageHeader";
import { Button, EmptyState, Skeleton, TextField } from "@/components/ui";
import { adminErrorMessage, etagOf } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { permits } from "@/lib/admin/permissions";
import { useDebounced } from "@/components/shell/useDebounced";
import { useUrlState } from "@/lib/admin/useUrlState";
import { createAdminProduct, listAdminProducts, updateAdminProduct, type AdminProductPage, type AdminProductRow, type AdminProductStatus } from "@/lib/api/admin-catalog";
import { cn } from "@/lib/cn";
import { useAdminSession } from "@/lib/stores/session";
import { toast } from "@/lib/stores/toast";
import { ProductCard } from "./ProductCard";
import { ProductDrawer } from "./ProductDrawer";

type Filter = "all" | "active" | "draft" | "low" | "out";
const FILTERS: { key: Filter; label: string }[] = [{ key: "all", label: "All" }, { key: "active", label: "Active" }, { key: "draft", label: "Draft" }, { key: "low", label: "Low stock" }, { key: "out", label: "Out of stock" }];
const PAGE = 24;

const paramsFor = (filter: Filter, q: string) => ({
  ...(q ? { q } : {}),
  ...(filter === "active" ? { status: "active" as AdminProductStatus } : filter === "draft" ? { status: "draft" as AdminProductStatus } : filter === "low" ? { stock: "low" as const } : filter === "out" ? { stock: "out" as const } : {}),
});

/** The catalogue: a grid of product cards you filter and search, with the editor in a drawer (`?product=<id>`). */
export function ProductsPage() {
  const queryClient = useQueryClient();
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canWrite = permits(held, "catalog:write");
  const [filter, setFilter] = useUrlState("status");
  const [search, setSearch] = useUrlState("q");
  const [openId, setOpenId] = useUrlState("product");
  const active: Filter = (FILTERS.find((f) => f.key === filter)?.key ?? "all") as Filter;
  const [draftSearch, setDraftSearch] = useState(search ?? "");
  const q = useDebounced(draftSearch.trim(), 300);
  const [creating, setCreating] = useState(false);

  const params = paramsFor(active, q);
  const listKey = adminKeys.list("products", params);
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam, signal }) => listAdminProducts({ ...params, limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data);
  const summary = list.data?.pages[0]?.summary;

  // The featured star changes at once and is put back if the server refuses.
  const feature = useMutation({
    mutationFn: ({ row, featured }: { row: AdminProductRow; featured: boolean }) => updateAdminProduct(row.id, etagOf(row.updatedAt), { featured }),
    onMutate: async ({ row, featured }) => {
      await queryClient.cancelQueries({ queryKey: adminKeys.resource("products") });
      const previous = queryClient.getQueryData<InfiniteData<AdminProductPage>>(listKey);
      queryClient.setQueryData<InfiniteData<AdminProductPage>>(listKey, (data) => data && { ...data, pages: data.pages.map((pg) => ({ ...pg, data: pg.data.map((r) => (r.id === row.id ? { ...r, featured } : r)) })) });
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(listKey, context?.previous);
      toast.error(adminErrorMessage(err));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: adminKeys.resource("products") }),
  });

  async function create(title: string) {
    const { data } = await createAdminProduct(title);
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("products") });
    setCreating(false);
    toast.success("Draft created. Add its options and photos next.");
    setOpenId(data.product.id, { push: true });
  }

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={summary ? `${summary.products} products · ${summary.variants.toLocaleString("en-NG")} variants · ${summary.lowStock} low on stock` : " "}
        actions={<><Button href="/admin/products/organise" variant="outline">Categories & collections</Button>{canWrite ? <Button iconLeft={<Plus aria-hidden="true" size={16} />} onClick={() => setCreating(true)}>New product</Button> : null}</>}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="Status" className="flex rounded-pill border border-line bg-surface p-1">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={active === f.key} onClick={() => setFilter(f.key === "all" ? null : f.key)} className={cn("h-[34px] rounded-pill px-3.5 font-semibold", active === f.key ? "bg-primary text-on-primary" : "text-ink")}>{f.label}</button>
          ))}
        </div>
        <label className="flex h-[42px] min-w-[220px] flex-1 items-center gap-2 rounded-pill border border-line bg-surface px-3.5">
          <Search aria-hidden="true" size={16} strokeWidth={2} className="text-primary-strong" />
          <span className="sr-only">Search products</span>
          <input type="search" value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} onBlur={() => setSearch(q || null)} placeholder="Search by name or SKU" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
        </label>
      </div>

      {list.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-5 text-danger">
          <span>We couldn&apos;t load products.</span>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>
        </div>
      ) : !rows ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-60 rounded-card" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={q || active !== "all" ? "No products match" : "No products yet"} action={canWrite && !q && active === "all" ? <Button onClick={() => setCreating(true)}>New product</Button> : undefined}>
          {q || active !== "all" ? "Try a different search or filter." : "Create your first product to start selling."}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-3">
            {rows.map((row) => (
              <ProductCard key={row.id} product={row} selected={openId === row.id} onOpen={() => setOpenId(row.id, { push: true })} {...(canWrite ? { onToggleFeatured: (featured: boolean) => feature.mutate({ row, featured }) } : {})} />
            ))}
          </div>
          {list.hasNextPage ? <Button variant="outline" className="self-center" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Show more</Button> : null}
        </>
      )}

      {openId ? <ProductDrawer productId={openId} onClose={() => setOpenId(null)} canWrite={canWrite} /> : null}
      <NewProductDialog open={creating} onCancel={() => setCreating(false)} onCreate={create} />
    </>
  );
}

function NewProductDialog({ open, onCancel, onCreate }: { open: boolean; onCancel: () => void; onCreate: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!title.trim()) return setError("Enter a name for the product");
    setBusy(true);
    try {
      await onCreate(title.trim());
      setTitle("");
      setError(undefined);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog open={open} title="New product" confirmLabel="Create draft" busy={busy} initialFocus="content" onCancel={() => { setError(undefined); onCancel(); }} onConfirm={() => void submit()}>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <TextField size="admin" label="Product name" autoFocus value={title} error={error} onChange={(e) => { setTitle(e.target.value); setError(undefined); }} hint="It starts as a draft: customers see nothing until you publish it." />
      </form>
    </ConfirmDialog>
  );
}
