"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { countText, ReviewSelection, SelectAllToggle, SelectionBar, type Noun } from "../selection/SelectionControls";
import { useBulkAction } from "../selection/useBulkAction";
import { CategoryDrawer, CollectionDrawer } from "./TaxonomyDrawers";
import { Button, EmptyState, Segmented, Skeleton, StatusPill } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { permits } from "@/lib/admin/permissions";
import { categoryTree, productCountText } from "@/lib/admin/taxonomy";
import { MAX_SELECTION, rangeBetween, useSelection, type SelectionItem } from "@/lib/admin/selection";
import { useUrlState } from "@/lib/admin/useUrlState";
import { bulkCategoryActive, listAdminCategoryRows, listAdminCollectionRows, type BulkCategoryResult, type CategoryRow, type CollectionRow } from "@/lib/api/admin-catalog";
import { useAdminSession } from "@/lib/stores/session";
import { toast } from "@/lib/stores/toast";

const NOUN: Noun = { one: "category", many: "categories" };
const itemOf = (c: CategoryRow): SelectionItem => ({ id: c.id, label: c.name, detail: c.active ? "Showing" : "Hidden" });

const TABS = [{ value: "categories", label: "Categories" }, { value: "collections", label: "Collections" }] as const;

/** How the catalogue is organised: categories (a tree shoppers browse by) and collections (hand-picked, ordered sets). */
export function TaxonomyPage() {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canWrite = permits(held, "catalog:write");
  const queryClient = useQueryClient();
  const [tabParam, setTab] = useUrlState("tab");
  const tab = TABS.find((t) => t.value === tabParam)?.value ?? "categories";
  const [editCategory, setEditCategory] = useState<CategoryRow | "new" | null>(null);
  const [editCollection, setEditCollection] = useState<CollectionRow | "new" | null>(null);

  const categories = useQuery({ queryKey: adminKeys.list("taxonomy", { kind: "categories" }), queryFn: ({ signal }) => listAdminCategoryRows({ signal }), staleTime: 0 });
  const collections = useQuery({ queryKey: adminKeys.list("taxonomy", { kind: "collections" }), queryFn: ({ signal }) => listAdminCollectionRows({ signal }), staleTime: 0 });
  // The selection lives outside the list, so it survives switching tabs and refreshes.
  const selection = useSelection("categories");
  const rows = categories.data ? categoryTree(categories.data) : [];
  const shownIds = rows.map((c) => c.id);
  const hiddenCount = selection.count - rows.filter((c) => selection.has(c.id)).length;
  const lastClicked = useRef<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const limitMessage = `You can select up to ${MAX_SELECTION} at a time.`;
  function toggleChecked(row: CategoryRow, shift: boolean) {
    if (shift && lastClicked.current && lastClicked.current !== row.id) {
      const on = !selection.has(row.id);
      const range = rangeBetween(shownIds, lastClicked.current, row.id).flatMap((id) => rows.filter((c) => c.id === id).map(itemOf));
      if (selection.setMany(range, on).limited) toast.error(limitMessage);
    } else if (!selection.toggle(itemOf(row))) {
      toast.error(limitMessage);
    }
    lastClicked.current = row.id;
  }
  const bulk = useBulkAction<boolean, BulkCategoryResult>({
    noun: NOUN,
    ids: selection.ids,
    plan: (active, n) => ({
      title: `${active ? "Show" : "Hide"} ${countText(n, NOUN)}?`,
      body: active ? "They appear in the shop menu again." : "Shoppers no longer see them in the shop menu. Their products and sub-categories stay as they are.",
      confirmLabel: `${active ? "Show" : "Hide"} ${n}`,
      tone: active ? "primary" : "danger",
    }),
    run: (ids, active) => bulkCategoryActive(ids, active),
    summary: (active, o) => (o.updated.length === 0 ? "No categories were changed." : `${active ? "Showing" : "Hid"} ${countText(o.updated.length, NOUN)}.`),
    undo: (o) => bulkCategoryActive(o.updated.map((u) => u.id), o.updated[0]?.previousActive ?? true),
    deselect: selection.remove,
    onChanged: () => done(),
  });
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("taxonomy") });
    void queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "collections"] });
  };

  return (
    <>
      <PageHeader
        title="Categories & collections"
        subtitle="How shoppers browse the catalogue."
        actions={<>
          <Button href="/admin/products" variant="outline">Back to products</Button>
          {canWrite ? <Button iconLeft={<Plus aria-hidden="true" size={16} />} onClick={() => (tab === "categories" ? setEditCategory("new") : setEditCollection("new"))}>{tab === "categories" ? "New category" : "New collection"}</Button> : null}
        </>}
      />
      <Segmented mode="tabs" label="Organise" className="self-start" items={TABS.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={(v) => setTab(v === "categories" ? null : v)} />

      {tab === "categories" ? (
        <section aria-label="Categories" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <p className="text-body-sm text-muted">A product can be in several categories. Sub-categories sit under their parent in the shop menu. Turning one off hides it from shoppers; products stay.</p>
          {categories.isError && !categories.data ? <Failure error={categories.error} onRetry={() => void categories.refetch()} /> : !categories.data ? <Skeleton className="h-48" /> : categories.data.length === 0 ? (
            <EmptyState title="No categories yet">Create one, like Frontal wigs, so products can be filed under it.</EmptyState>
          ) : (
            <>
            {canWrite ? <SelectAllToggle shown={shownIds} has={selection.has} noun={NOUN} onChange={(on) => { if (selection.setMany(rows.map(itemOf), on).limited) toast.error(limitMessage); }} /> : null}
            <ul>
              {rows.map((c) => (
                <li key={c.id} className={`flex flex-wrap items-center gap-3 border-b border-line-soft py-2.5 last:border-0 ${selection.has(c.id) ? "bg-surface-tint" : ""}`} style={{ paddingLeft: c.depth * 24 }}>
                  {canWrite ? (
                    <label className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
                      <span className="sr-only">Select {c.name}</span>
                      <input type="checkbox" checked={selection.has(c.id)} onChange={() => undefined} onClick={(e) => toggleChecked(c, e.shiftKey)} className="size-[22px] cursor-pointer accent-primary" />
                    </label>
                  ) : null}
                  <span className="flex min-w-0 flex-[1_1_220px] flex-col leading-[1.3]"><span className="font-bold">{c.name}</span><span className="text-caption text-muted">/{c.slug} · {productCountText(c.productCount)}</span></span>
                  {!c.active ? <StatusPill tone="neutral">Hidden</StatusPill> : null}
                  <Button size="sm" variant="outline" onClick={() => setEditCategory(c)}>{canWrite ? "Edit" : "View"}<span className="sr-only"> {c.name}</span></Button>
                </li>
              ))}
            </ul>
            </>
          )}
        </section>
      ) : (
        <section aria-label="Collections" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <p className="text-body-sm text-muted">A collection is a set of products you pick and put in order, like a seasonal edit. Promotions and the home page can point at one.</p>
          {collections.isError && !collections.data ? <Failure error={collections.error} onRetry={() => void collections.refetch()} /> : !collections.data ? <Skeleton className="h-48" /> : collections.data.length === 0 ? (
            <EmptyState title="No collections yet">Create one, like Summer edit, and add products to it.</EmptyState>
          ) : (
            <ul>
              {collections.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                  <span className="flex min-w-0 flex-[1_1_220px] flex-col leading-[1.3]"><span className="font-bold">{c.name}</span><span className="text-caption text-muted">/{c.slug} · {productCountText(c.productCount)}</span></span>
                  {!c.active ? <StatusPill tone="neutral">Hidden</StatusPill> : null}
                  <Button size="sm" variant="outline" onClick={() => setEditCollection(c)}>{canWrite ? "Edit" : "View"}<span className="sr-only"> {c.name}</span></Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="text-caption text-muted">To file a product, open it in <Link href="/admin/products" className="font-semibold text-primary-strong underline">Products</Link> and choose its category on the Basics tab.</p>

      {canWrite && tab === "categories" ? (
        <>
          <SelectionBar noun={NOUN} count={selection.count} hiddenCount={hiddenCount} busy={bulk.busy} onReview={() => setReviewing(true)} onClear={() => selection.clear()}>
            <Button size="sm" disabled={bulk.busy} onClick={() => bulk.request(true)}>Show</Button>
            <Button size="sm" variant="danger-soft" disabled={bulk.busy} onClick={() => bulk.request(false)}>Hide</Button>
          </SelectionBar>
          {selection.count > 0 ? <div aria-hidden="true" className="h-20" /> : null}
          <ReviewSelection open={reviewing && selection.count > 0} title="Selected categories" items={selection.items} noun={NOUN} onRemove={(id) => selection.remove([id])} onClear={() => { selection.clear(); setReviewing(false); }} onClose={() => setReviewing(false)} />
          {bulk.dialogs}
        </>
      ) : null}

      {editCategory ? <CategoryDrawer category={editCategory === "new" ? null : editCategory} all={categories.data ?? []} canWrite={canWrite} onClose={() => setEditCategory(null)} onSaved={() => { setEditCategory(null); done(); }} /> : null}
      {editCollection ? <CollectionDrawer collection={editCollection === "new" ? null : editCollection} canWrite={canWrite} onClose={() => setEditCollection(null)} onSaved={() => { setEditCollection(null); done(); }} /> : null}
    </>
  );
}

function Failure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger"><span>{adminErrorMessage(error)}</span><Button size="sm" variant="outline" onClick={onRetry}>Retry</Button></div>;
}
