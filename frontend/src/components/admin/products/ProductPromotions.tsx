"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Dropdown, Segmented, StatusPill, TextField } from "@/components/ui";
import { onAmountChange } from "@/lib/admin/amount";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { KIND_LABEL, promotionSummary, quickPromoForm, toInput, validateForm, type FormErrors, type PromoForm } from "@/lib/admin/promotions";
import { attachProductPromotion, createAdminPromotion, detachProductPromotion, listProductPromotions, setPromotionActive, type ProductPromotion } from "@/lib/api/admin-promotions";
import { formatDateTime } from "@/lib/format";
import { PROMOTION_STATUS } from "@/lib/status";
import { toast } from "@/lib/stores/toast";

const RELATION: Record<ProductPromotion["relation"], string> = {
  attached: "Chosen for this product",
  collection: "Applies through a collection this product is in",
  all: "Applies to every product",
  excluded: "This product is an exception",
  available: "",
};

type Props = { productId: string; productTitle: string; canWrite: boolean };

/**
 * The promotions that touch one product. Attach one that already exists (only those limited to chosen products or
 * collections can take another product), or make a simple new one for just this product without leaving the editor.
 * Each action is saved at once, like stock: it is a change to the promotion, not to the product.
 */
export function ProductPromotions({ productId, productTitle, canWrite }: Props) {
  const queryClient = useQueryClient();
  const key = ["admin", "product-promotions", productId] as const;
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => listProductPromotions(productId, { signal }), staleTime: 0 });
  const [pick, setPick] = useState("");
  const [creating, setCreating] = useState(false);

  const refreshed = (next: ProductPromotion[]) => {
    queryClient.setQueryData(key, next);
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("promotions") });
  };
  const attach = useMutation({
    mutationFn: (id: string) => attachProductPromotion(productId, id),
    onSuccess: (next, id) => { refreshed(next); setPick(""); toast.success(`${next.find((p) => p.id === id)?.name ?? "Promotion"} now applies to this product`); },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });
  const detach = useMutation({
    mutationFn: (id: string) => detachProductPromotion(productId, id),
    onSuccess: (next, id) => { refreshed(next); toast.success(`Taken off ${next.find((p) => p.id === id)?.name ?? "the promotion"}`); },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  // Switching off is how a promotion that names only this product is taken off it: removing the product would widen it to everything.
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setPromotionActive(id, active),
    onSuccess: (saved, { active }) => { toast.success(`${saved.promotion.name} is ${active ? "on" : "off"}`); void list.refetch(); void queryClient.invalidateQueries({ queryKey: adminKeys.resource("promotions") }); },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  const rows = list.data ?? [];
  const forProduct = rows.filter((p) => p.relation === "attached" || p.relation === "collection" || p.relation === "excluded");
  const storeWide = rows.filter((p) => p.relation === "all");
  const available = rows.filter((p) => p.relation === "available");

  return (
    <section aria-label="Promotions" className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-display text-body-lg font-extrabold">Promotions</h3>
        <p className="text-caption text-muted">Discounts that apply to {productTitle || "this product"}. Add this product to one limited to chosen products, or make a new one just for it. To change what a promotion does, open it in Promotions.</p>
      </div>

      {list.isError && !list.data ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md bg-danger-bg p-3 text-body-sm text-danger"><span>{adminErrorMessage(list.error)}</span><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></div>
      ) : !list.data ? (
        <p className="text-caption text-muted">Loading promotions…</p>
      ) : (
        <>
          {forProduct.length ? (
            <ul aria-label="Promotions on this product" className="flex flex-col gap-2">
              {forProduct.map((p) => {
                const pill = PROMOTION_STATUS[p.lifecycle] ?? PROMOTION_STATUS.draft!;
                const busy = (detach.isPending && detach.variables === p.id) || (toggle.isPending && toggle.variables?.id === p.id);
                const off = p.lifecycle === "inactive";
                return (
                  <li key={p.id} className="flex flex-col gap-2 rounded-md bg-surface-tint px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                      <span className="flex flex-wrap items-center gap-2"><span className="font-bold">{p.name}</span><StatusPill tone={pill.tone}>{pill.label}</StatusPill></span>
                      <span className="text-caption text-muted">{KIND_LABEL[p.kind]} · {promotionSummary(p.kind, p.configuration)}{p.startsAt ? ` · from ${formatDateTime(p.startsAt)}` : ""}{p.endsAt ? ` · until ${formatDateTime(p.endsAt)}` : ""}</span>
                      <span className="text-caption text-ink-soft">{RELATION[p.relation]}</span>
                      {canWrite && p.relation === "attached" && !p.removable ? <span className="text-caption text-muted">This product is the only one on it. To take it off, switch the promotion off.</span> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <a href={`/admin/promotions/${p.id}`} target="_blank" rel="noreferrer" className="text-label font-bold text-primary-strong underline">View in Promotions<span className="sr-only">: {p.name}</span></a>
                      {canWrite && p.relation === "attached" ? (
                        p.removable
                          ? <Button size="sm" variant="outline" loading={busy} disabled={detach.isPending || toggle.isPending} onClick={() => detach.mutate(p.id)}>Remove<span className="sr-only"> {p.name} from this product</span></Button>
                          : <Button size="sm" variant="outline" loading={busy} disabled={detach.isPending || toggle.isPending} onClick={() => toggle.mutate({ id: p.id, active: off })}>{off ? "Switch on" : "Switch off"}<span className="sr-only"> {p.name}</span></Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-md bg-surface-tint px-3 py-2.5 text-body-sm text-ink-soft">No promotion is set up for this product specifically.</p>
          )}

          {storeWide.length ? (
            <details className="rounded-md border border-line px-3 py-2 text-body-sm">
              <summary className="cursor-pointer font-semibold">{storeWide.length} store-wide {storeWide.length === 1 ? "promotion" : "promotions"} also apply</summary>
              <ul aria-label="Promotions on every product" className="mt-2 flex flex-col gap-1.5">
                {storeWide.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 text-caption">
                    <span><span className="font-bold">{p.name}</span> <span className="text-muted">· {KIND_LABEL[p.kind]} · {promotionSummary(p.kind, p.configuration)} · {(PROMOTION_STATUS[p.lifecycle] ?? PROMOTION_STATUS.draft!).label}</span></span>
                    <a href={`/admin/promotions/${p.id}`} target="_blank" rel="noreferrer" className="font-bold text-primary-strong underline">View in Promotions<span className="sr-only">: {p.name}</span></a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {canWrite ? (
            <>
              {available.length ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex min-w-48 flex-1 flex-col gap-1">
                    <label htmlFor="attach-promotion" className="text-label font-semibold">Add an existing promotion</label>
                    <Dropdown id="attach-promotion" value={pick} onChange={(e) => setPick(e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 text-body-sm font-normal">
                      <option value="">Choose a promotion</option>
                      {available.map((p) => <option key={p.id} value={p.id}>{p.name} · {promotionSummary(p.kind, p.configuration)} · {(PROMOTION_STATUS[p.lifecycle] ?? PROMOTION_STATUS.draft!).label}</option>)}
                    </Dropdown>
                  </div>
                  <Button disabled={!pick || attach.isPending} loading={attach.isPending} onClick={() => attach.mutate(pick)}>Attach</Button>
                </div>
              ) : (
                <p className="rounded-md border border-line px-3 py-2 text-caption text-muted">Nothing to attach yet. Only promotions limited to chosen products or collections can take this product on. Promotions for every product already apply to it, and ended, draft and free-delivery promotions are not listed. Create one below to target this product.</p>
              )}

              {creating ? (
                <QuickPromotion productId={productId} productTitle={productTitle} onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); void list.refetch(); void queryClient.invalidateQueries({ queryKey: adminKeys.resource("promotions") }); }} />
              ) : (
                <Button variant="outline" className="self-start" onClick={() => setCreating(true)}>+ Create a promotion for this product</Button>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/** A short form for the two simplest kinds, aimed at this one product. For a code, limits or anything else, the full builder is one click away. */
function QuickPromotion({ productId, productTitle, onCancel, onCreated }: { productId: string; productTitle: string; onCancel: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<PromoForm>(() => ({ ...quickPromoForm(productId, productTitle), percent: "" }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<string>();
  const set = <K extends keyof PromoForm>(k: K, v: PromoForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setProblem(undefined); };
  const save = useMutation({
    // Drafts are written in Promotions, so one made here is switched on straight away.
    mutationFn: async () => setPromotionActive((await createAdminPromotion(toInput(form))).promotion.id, true),
    onSuccess: (saved) => { toast.success(`${saved.promotion.name} is on for this product`); onCreated(); },
    onError: (err) => setProblem(adminErrorMessage(err)),
  });

  function submit() {
    const found = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    save.mutate();
  }
  const percent = form.kind === "percentage";
  return (
    <form className="flex flex-col gap-3 rounded-lg bg-surface-tint p-3.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="font-extrabold">New promotion for {productTitle || "this product"}</p>
      <TextField size="admin" label="Name" value={form.name} error={errors.name} onChange={(e) => set("name", e.target.value)} hint="Only your team sees this" />
      <div className="flex flex-col gap-1.5">
        <span className="text-label font-semibold">What does it take off?</span>
        <Segmented outlined label="Kind of discount" className="self-start" items={[{ value: "percentage", label: "A percentage" }, { value: "fixed_amount", label: "A fixed amount" }]} value={form.kind} onChange={(v) => set("kind", v)} />
      </div>
      {percent
        ? <TextField size="admin" label="Percent off (%)" inputMode="decimal" value={form.percent} error={errors.percent} onChange={(e) => set("percent", e.target.value.replace(/[^\d.]/g, ""))} hint="1 to 90" />
        : <TextField size="admin" label="Amount off" prefix="₦" inputMode="decimal" value={form.amount} error={errors.amount} onChange={onAmountChange(form.amount, (v) => set("amount", v))} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-label font-semibold">Starts (optional, Lagos time)<input type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
        <label className="flex flex-col gap-1 text-label font-semibold">Ends (optional, Lagos time)<input type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} aria-invalid={errors.endsAt ? true : undefined} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      </div>
      {errors.startsAt || errors.endsAt ? <p role="alert" className="text-caption font-medium text-danger">{errors.startsAt ?? errors.endsAt}</p> : null}
      <p className="text-caption text-muted">It applies automatically to this product only. Need a code, limits or a different kind? <a href="/admin/promotions/new" target="_blank" rel="noreferrer" className="font-bold text-primary-strong underline">Open the full builder</a>.</p>
      {problem ? <p role="alert" className="text-label font-semibold text-danger">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} disabled={save.isPending}>Create and switch on</Button>
        <Button variant="ghost-link" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
