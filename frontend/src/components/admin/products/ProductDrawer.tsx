"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Media, Segmented, Skeleton } from "@/components/ui";
import { adminErrorMessage, isStaleRecord } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { fromDetail, isChanged, toPayload, type MatrixDraft } from "@/lib/admin/matrix";
import { basicsFrom, changedFields, validateBasics, type Basics } from "@/lib/admin/productForm";
import { useUrlState } from "@/lib/admin/useUrlState";
import { getAdminProduct, listAdminCategories, putMatrix, setAdminProductStatus, updateAdminProduct, type AdminProductDetail, type Versioned } from "@/lib/api/admin-catalog";
import { toast } from "@/lib/stores/toast";
import { SideDrawer } from "../SideDrawer";
import { BasicsTab } from "./BasicsTab";
import { MediaTab } from "./MediaTab";
import { MerchTab } from "./MerchTab";
import { VariantsTab } from "./VariantsTab";

const TABS = [{ value: "basics", label: "Basics" }, { value: "variants", label: "Variants" }, { value: "media", label: "Media" }, { value: "merch", label: "Merchandising" }] as const;
type Tab = (typeof TABS)[number]["value"];

/** Loads a product and shows its editor in the drawer. */
export function ProductDrawer({ productId, onClose, canWrite }: { productId: string; onClose: () => void; canWrite: boolean }) {
  const detail = useQuery({ queryKey: adminKeys.detail("products", productId), queryFn: ({ signal }) => getAdminProduct(productId, { signal }), staleTime: 0 });
  const categories = useQuery({ queryKey: ["admin", "categories"], queryFn: ({ signal }) => listAdminCategories({ signal }), staleTime: 5 * 60_000 });

  if (!detail.data) {
    return (
      <SideDrawer open onClose={onClose} title="Edit product" compactTitle>
        {detail.isError ? (
          <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger">
            <span>{adminErrorMessage(detail.error)}</span>
            <Button size="sm" variant="outline" onClick={() => detail.refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4"><Skeleton className="h-14" /><Skeleton className="h-9" /><Skeleton className="h-48" /></div>
        )}
      </SideDrawer>
    );
  }
  return <ProductEditor initial={detail.data} categories={categories.data ?? []} onClose={onClose} canWrite={canWrite} reload={() => detail.refetch()} />;
}

type Props = { initial: Versioned<AdminProductDetail>; categories: Awaited<ReturnType<typeof listAdminCategories>>; onClose: () => void; canWrite: boolean; reload: () => Promise<unknown> };

function ProductEditor({ initial, categories, onClose, canWrite, reload }: Props) {
  const queryClient = useQueryClient();
  const [tabParam, setTab] = useUrlState("tab");
  const tab: Tab = (TABS.find((t) => t.value === tabParam)?.value ?? "basics") as Tab;

  // What was last loaded or saved, and the edits on top of it.
  const [base, setBase] = useState(() => ({ detail: initial.data, etag: initial.etag, basics: basicsFrom(initial.data), matrix: fromDetail(initial.data) }));
  const [basics, setBasics] = useState<Basics>(base.basics);
  const [matrix, setMatrix] = useState<MatrixDraft>(base.matrix);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; stale: boolean } | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const product = base.detail.product;
  const fields = changedFields(base.basics, basics, product.categoryIds);
  const statusChanged = basics.status !== base.basics.status;
  const matrixChanged = isChanged(base.matrix, matrix);
  const dirty = !!fields || statusChanged || matrixChanged;
  const titleError = showErrors ? validateBasics(basics).title : undefined;
  const cover = base.detail.media.find((m) => m.isCover) ?? base.detail.media[0];
  const categoryName = categories.find((c) => c.id === basics.categoryId)?.name ?? "No category";
  const disabled = !canWrite || saving;

  /** Saves what changed, in an order that lets each step use the version the one before it produced. */
  async function save() {
    setShowErrors(true);
    if (validateBasics(basics).title) {
      setTab("basics");
      return;
    }
    setSaving(true);
    setProblem(null);
    let latest: Versioned<AdminProductDetail> = { data: base.detail, etag: base.etag };
    try {
      if (fields) latest = await updateAdminProduct(product.id, latest.etag, fields);
      if (matrixChanged) latest = await putMatrix(product.id, latest.etag, toPayload(matrix));
      if (statusChanged) latest = await setAdminProductStatus(product.id, basics.status === "active" ? "publish" : "archive");
      commit(latest);
      toast.success("Saved");
    } catch (err) {
      // Whatever was saved before the failure is kept as the new starting point; the rest stays as typed.
      if (latest.data !== base.detail) setBase((b) => ({ ...b, detail: latest.data, etag: latest.etag }));
      setProblem({ message: adminErrorMessage(err), stale: isStaleRecord(err) });
    } finally {
      setSaving(false);
    }
  }

  function commit(saved: Versioned<AdminProductDetail>) {
    const next = { detail: saved.data, etag: saved.etag, basics: basicsFrom(saved.data), matrix: fromDetail(saved.data) };
    setBase(next);
    setBasics(next.basics);
    setMatrix(next.matrix);
    queryClient.setQueryData(adminKeys.detail("products", product.id), saved);
    void queryClient.invalidateQueries({ queryKey: adminKeys.list("products") });
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("products") });
  }

  /** Photos and stock are saved on their own; fold their fresh state in without touching the edits. */
  function refreshed(saved: Versioned<AdminProductDetail>) {
    setBase((b) => ({ ...b, detail: saved.data, etag: saved.etag }));
    queryClient.setQueryData(adminKeys.detail("products", product.id), saved);
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("products") });
  }

  async function reloadAndDiscard() {
    const fresh = await reload();
    const data = (fresh as { data?: Versioned<AdminProductDetail> }).data;
    if (data) commit(data);
    setProblem(null);
  }

  return (
    <SideDrawer open onClose={onClose} title="Edit product" compactTitle dirty={dirty}>
      <div className="flex items-center gap-3 border-b border-line-soft p-4">
        <Media image={cover?.url ? { url: cover.url } : null} alt="" aspect="1 / 1" className="size-14 shrink-0 rounded-md" sizes="56px" />
        <div className="flex min-w-0 flex-1 flex-col leading-[1.3]">
          <span className="text-caption text-muted">{categoryName}</span>
          <span className="truncate font-display text-heading-xs font-extrabold">{basics.title || product.title}</span>
        </div>
        {canWrite ? <Button variant="dark" loading={saving} disabled={!dirty} onClick={() => void save()}>Save</Button> : null}
      </div>

      {problem ? (
        <div role="alert" className="m-4 mb-0 flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
          <span>{problem.message}</span>
          {problem.stale ? <Button size="sm" variant="outline" onClick={() => void reloadAndDiscard()}>Reload</Button> : null}
        </div>
      ) : null}

      <div className="px-4 pt-3">
        <Segmented mode="tabs" label="Product sections" className="flex w-full [&>button]:min-h-9 [&>button]:flex-1 [&>button]:justify-center [&>button]:font-bold" items={TABS.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={(v) => setTab(v === "basics" ? null : v)} />
      </div>

      {tab === "basics" ? (
        <BasicsTab basics={basics} originalStatus={base.basics.status} categories={categories} titleError={titleError} disabled={disabled} onChange={(patch) => setBasics((b) => ({ ...b, ...patch }))} />
      ) : tab === "variants" ? (
        <VariantsTab productId={product.id} title={basics.title || product.title} slug={product.slug} matrix={matrix} baseline={base.matrix} disabled={disabled} onMatrix={setMatrix} onBaseline={(m) => setBase((b) => ({ ...b, matrix: typeof m === "function" ? m(b.matrix) : m }))} />
      ) : tab === "media" ? (
        <MediaTab productId={product.id} media={base.detail.media} variants={matrix.variants} disabled={disabled} onSaved={refreshed} />
      ) : (
        <MerchTab basics={basics} disabled={disabled} onChange={(patch) => setBasics((b) => ({ ...b, ...patch }))} />
      )}
    </SideDrawer>
  );
}
