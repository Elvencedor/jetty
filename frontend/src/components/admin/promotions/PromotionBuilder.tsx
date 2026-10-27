"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { ProductPicker } from "../ProductPicker";
import { Button, Skeleton, StatusPill, Switch, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { type Lookups, announcementText, bagPreview, emptyForm, ERROR_STEP, formFromPromotion, generateCode, KIND_LABEL, normaliseCodeText, sentenceParts, STEPS, submitLabel, toInput, TYPES, validateForm, type FormErrors, type PromoForm } from "@/lib/admin/promotions";
import { permits } from "@/lib/admin/permissions";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";
import { getAdminProduct } from "@/lib/api/admin-catalog";
import { listZones } from "@/lib/api/admin-settings";
import { createAdminPromotion, getAdminPromotion, listAdminCollections, setPromotionActive, updateAdminPromotion, type Collection, type PromotionDetail } from "@/lib/api/admin-promotions";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNaira } from "@/lib/format";
import { PROMOTION_STATUS } from "@/lib/status";
import { useAdminSession } from "@/lib/stores/session";
import { toast } from "@/lib/stores/toast";

/** The builder at `/admin/promotions/new`, and the editor at `/admin/promotions/{id}`. */
export function PromotionBuilder({ id }: { id?: string }) {
  const detail = useQuery({ queryKey: adminKeys.detail("promotions", id ?? "new"), queryFn: ({ signal }) => getAdminPromotion(id!, { signal }), enabled: !!id, staleTime: 0 });
  const collections = useQuery({ queryKey: ["admin", "collections"], queryFn: ({ signal }) => listAdminCollections({ signal }), staleTime: 5 * 60_000 });
  if (id && !detail.data) {
    return (
      <>
        <PageHeader title="Promotion" />
        {detail.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-5 text-danger"><span>{adminErrorMessage(detail.error)}</span><Button size="sm" variant="outline" onClick={() => void detail.refetch()}>Retry</Button></div>
        ) : <Skeleton className="h-96 rounded-card" />}
      </>
    );
  }
  return <Builder key={detail.data?.promotion.id ?? "new"} existing={detail.data} collections={collections.data ?? []} />;
}

function Builder({ existing, collections }: { existing: PromotionDetail | undefined; collections: Collection[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canWrite = permits(held, "promotions:write");
  const editing = !!existing;
  const [original] = useState(() => (existing ? formFromPromotion(existing) : emptyForm()));
  const [form, setForm] = useState<PromoForm>(original);
  const [step, setStep] = useState(existing ? 1 : 0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  // Names for the products and zones the form picked by id, so the rule reads in words.
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map());
  const zones = useQuery({ queryKey: ["admin", "zones"], queryFn: ({ signal }) => listZones({ signal }), staleTime: 5 * 60_000 });
  const [now] = useState(() => new Date());
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useUnsavedGuard(dirty);
  // Each step's heading takes focus, so a keyboard or screen-reader user lands on what changed.
  useEffect(() => heading.current?.focus(), [step]);

  const locked = editing && existing.promotion.usageCount > 0; // redeemed promotions keep their type
  const ended = existing?.promotion.lifecycle === "ended";
  const live = existing?.promotion.lifecycle === "live";
  const set = <K extends keyof PromoForm>(key: K, value: PromoForm[K]) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key === "collectionIds" ? "collections" : key === "productIds" ? "products" : key === "zoneIds" ? "zones" : key]: undefined })); setProblem(undefined); };

  const save = useMutation({
    mutationFn: async (activate: boolean) => {
      const input = toInput(form);
      const body = existing ? { ...input, ...(form.access === "code" && !existing.codes.length ? { codes: [{ code: form.code }] } : {}) } : { ...input, ...(form.access === "code" ? { codes: [{ code: form.code }] } : {}) };
      const saved = existing ? await updateAdminPromotion(existing.promotion.id, body) : await createAdminPromotion(body);
      if (activate && saved.promotion.status !== "active") return setPromotionActive(saved.promotion.id, true);
      return saved;
    },
    onSuccess: (saved, activate) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.resource("promotions") });
      const start = saved.promotion.startsAt;
      toast.success(existing ? "Promotion saved" : !activate ? `${saved.promotion.name} saved as a draft` : start && Date.parse(start) > now.getTime() ? `${saved.promotion.name} scheduled for ${formatDateTime(start)}` : `${saved.promotion.name} is live`);
      router.push("/admin/promotions");
    },
    onError: (err) => setProblem(adminErrorMessage(err)),
  });

  function submit(activate: boolean) {
    const found = validateForm(form);
    setErrors(found);
    const first = (Object.keys(found) as (keyof FormErrors)[]).sort((a, b) => ERROR_STEP[a] - ERROR_STEP[b])[0];
    if (first) return setStep(ERROR_STEP[first]);
    setProblem(undefined);
    save.mutate(activate);
  }

  const productIds = [...new Set([...form.productIds, ...form.excludeProductIds])];
  const fetched = useQueries({ queries: productIds.filter((id) => !picked.has(id)).map((id) => ({ queryKey: adminKeys.detail("products", id), queryFn: ({ signal }: { signal: AbortSignal }) => getAdminProduct(id, { signal }), staleTime: 60_000 })) });
  const products = new Map(picked);
  for (const q of fetched) if (q.data) products.set(q.data.data.product.id, q.data.data.product.title);
  const lookups = { products, zones: new Map((zones.data ?? []).map((z) => [z.id, z.name])) };
  const remember = (id: string, title: string) => setPicked((m) => new Map(m).set(id, title));
  const parts = sentenceParts(form, collections, lookups);

  return (
    <>
      <PageHeader title={editing ? existing.promotion.name : "New promotion"} subtitle={editing ? `${KIND_LABEL[existing.promotion.kind]}${existing.codes[0] ? ` · code ${existing.codes[0].code}` : " · automatic"}` : "Make a discount, code or free delivery in four steps."} actions={editing ? <StatusPill tone={PROMOTION_STATUS[existing.promotion.lifecycle]?.tone ?? "neutral"}>{PROMOTION_STATUS[existing.promotion.lifecycle]?.label}</StatusPill> : null} />

      <div className="flex flex-wrap items-start gap-[18px]">
        <section aria-label={editing ? "Edit promotion" : "New promotion"} className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px] rounded-card border border-line bg-surface p-5">
          <ol aria-label="Steps" className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s}><button type="button" aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)} className={cn("h-8 rounded-pill px-3 text-caption font-bold", i === step ? "bg-surface-inverse text-on-inverse" : "bg-surface-tint text-ink")}>{i + 1} {s}</button></li>
            ))}
          </ol>
          <h2 ref={heading} tabIndex={-1} className="font-display text-heading-sm font-extrabold outline-none">{STEPS[step]}</h2>
          {ended ? <p role="status" className="rounded-lg bg-warning-bg px-3 py-2 text-body-sm text-warning">This promotion has ended. Move its end date to edit it again.</p> : null}
          {live ? <p role="status" className="rounded-lg bg-info-bg px-3 py-2 text-body-sm text-info">Changes apply to new baskets immediately.</p> : null}
          {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{problem}</p> : null}

          {step === 0 ? (
            <div role="radiogroup" aria-label="Promotion type" className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-2.5">
              {TYPES.map((t) => {
                const on = form.kind === t.kind;
                return (
                  <button key={t.kind} type="button" role="radio" aria-checked={on} disabled={locked && !on} onClick={() => set("kind", t.kind)} className={cn("flex min-h-[120px] flex-col justify-between gap-2 rounded-[20px] border-2 p-3.5 text-left disabled:opacity-50", on ? "border-primary bg-surface-tint" : "border-line bg-surface")}>
                    <span aria-hidden="true" className="font-display text-heading-sm font-extrabold leading-none text-primary">{t.glyph}</span>
                    <span className="flex flex-col leading-[1.3]"><span className="font-bold">{t.label}</span><span className="text-caption text-muted">{t.note}</span></span>
                  </button>
                );
              })}
              {locked ? <p className="col-span-full text-caption text-muted">This promotion has been used, so its type can&apos;t change. Create a new one instead.</p> : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-3.5">
              <TextField size="admin" label="Name" value={form.name} error={errors.name} onChange={(e) => set("name", e.target.value)} hint="Only your team sees this, like Flash sale: frontals" />
              <div className="flex flex-wrap items-center gap-2 rounded-[20px] bg-surface-tint p-4 text-body leading-[2.4]">
                {parts.map((p, i) => p.field === "scope" ? (
                  <select key={i} aria-label="Which products" value={form.scope} onChange={(e) => set("scope", e.target.value as PromoForm["scope"])} className="h-9 max-w-full rounded-[12px] border-[1.5px] border-primary bg-surface px-2.5 font-bold">
                    <option value="all">all products</option>
                    <option value="collections">chosen collections</option>
                    <option value="products">chosen products</option>
                    {form.scope === "mixed" ? <option value="mixed">chosen collections and products</option> : null}
                  </select>
                ) : p.field ? (
                  <input key={i} aria-label={FIELD_LABEL[p.field]} inputMode="decimal" size={Math.max((form[p.field] || "").length, 2)} value={form[p.field]} onChange={(e) => set(p.field!, e.target.value)} className="h-9 rounded-[12px] border-[1.5px] border-primary bg-surface px-2.5 text-center font-bold" />
                ) : <span key={i}>{p.text}</span>)}
              </div>
              <p role="status" className="text-body-sm text-ink-soft">{parts.map((p) => p.text).join("")}</p>
              {(["percent", "amount", "buy", "get", "percentOff", "collections", "products", "zones"] as const).map((k) => errors[k] ? <p key={k} role="alert" className="text-caption font-medium text-danger">{errors[k]}</p> : null)}
              {form.kind === "buy_x_get_y" ? (
                <label className="flex max-w-xs flex-col gap-1 text-label font-semibold">Percent off the free items
                  <select value={form.percentOff} onChange={(e) => set("percentOff", e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal"><option value="100">100% (free)</option><option value="50">50% off</option><option value="25">25% off</option></select>
                </label>
              ) : null}
              {(form.scope === "collections" || form.scope === "mixed") && form.kind !== "free_delivery" ? (
                <fieldset className="flex flex-wrap gap-2"><legend className="mb-1 text-label font-semibold">Collections</legend>
                  {collections.length === 0 ? <span className="text-body-sm text-muted">No collections yet.</span> : collections.map((c) => {
                    const on = form.collectionIds.includes(c.id);
                    return <button key={c.id} type="button" aria-pressed={on} onClick={() => set("collectionIds", on ? form.collectionIds.filter((x) => x !== c.id) : [...form.collectionIds, c.id])} className={cn("h-9 rounded-pill border-[1.5px] px-3.5 font-semibold", on ? "border-primary bg-surface-tint text-primary-strong" : "border-line-strong bg-surface text-ink")}>{c.name}</button>;
                  })}
                </fieldset>
              ) : null}
              {(form.scope === "products" || form.scope === "mixed") && form.kind !== "free_delivery" ? (
                <ProductPicker label="Products it applies to" ids={form.productIds} titles={products} onAdd={(id, title) => { remember(id, title); set("productIds", [...form.productIds, id]); }} onRemove={(id) => set("productIds", form.productIds.filter((x) => x !== id))} />
              ) : null}
              {form.kind !== "free_delivery" ? (
                <details className="rounded-lg border border-line p-3" open={form.excludeProductIds.length > 0}>
                  <summary className="cursor-pointer font-semibold">Except some products{form.excludeProductIds.length ? ` (${form.excludeProductIds.length})` : ""}</summary>
                  <div className="mt-2"><ProductPicker label="Products it never applies to" ids={form.excludeProductIds} titles={products} onAdd={(id, title) => { remember(id, title); set("excludeProductIds", [...form.excludeProductIds, id]); }} onRemove={(id) => set("excludeProductIds", form.excludeProductIds.filter((x) => x !== id))} /></div>
                </details>
              ) : null}
              {form.kind === "free_delivery" ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-label font-semibold">Where is delivery free?</legend>
                  <div role="group" aria-label="Where delivery is free" className="flex w-fit rounded-pill bg-surface-tint p-1">
                    {(["all", "chosen"] as const).map((z) => <button key={z} type="button" aria-pressed={form.zones === z} onClick={() => set("zones", z)} className={cn("h-9 rounded-pill px-3.5 font-bold", form.zones === z ? "bg-primary text-on-primary" : "text-ink")}>{z === "all" ? "Everywhere" : "Only some zones"}</button>)}
                  </div>
                  {form.zones === "chosen" ? (
                    <div className="flex flex-wrap gap-2">
                      {(zones.data ?? []).map((z) => {
                        const on = form.zoneIds.includes(z.id);
                        return <button key={z.id} type="button" aria-pressed={on} onClick={() => set("zoneIds", on ? form.zoneIds.filter((x) => x !== z.id) : [...form.zoneIds, z.id])} className={cn("h-9 rounded-pill border-[1.5px] px-3.5 font-semibold", on ? "border-primary bg-surface-tint text-primary-strong" : "border-line-strong bg-surface text-ink")}>{z.name}</button>;
                      })}
                      {zones.data?.length === 0 ? <span className="text-body-sm text-muted">No delivery zones yet. Add them in Settings.</span> : null}
                    </div>
                  ) : null}
                </fieldset>
              ) : null}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-bold">Customers get it</span>
                <div role="group" aria-label="How customers get it" className="flex rounded-pill bg-surface-tint p-1">
                  {(["automatic", "code"] as const).map((a) => (
                    <button key={a} type="button" aria-pressed={form.access === a} disabled={editing && existing.codes.length > 0 && a === "automatic"} onClick={() => set("access", a)} className={cn("h-9 rounded-pill px-3.5 font-bold disabled:opacity-50", form.access === a ? "bg-primary text-on-primary" : "text-ink")}>{a === "automatic" ? "Automatically" : "With a code"}</button>
                  ))}
                </div>
                {form.access === "code" ? (
                  <>
                    <label className="flex"><span className="sr-only">Code</span><input value={form.code} disabled={editing && existing.codes.length > 0} onChange={(e) => set("code", normaliseCodeText(e.target.value))} placeholder="FLASH15" aria-invalid={errors.code ? true : undefined} className="h-10 w-40 rounded-pill border-[1.5px] border-line-strong bg-surface px-3.5 font-bold uppercase tracking-wide disabled:opacity-60" /></label>
                    {!(editing && existing.codes.length > 0) ? <Button size="sm" variant="outline" onClick={() => set("code", generateCode())}>Generate</Button> : null}
                  </>
                ) : null}
              </div>
              {errors.code ? <p role="alert" className="text-caption font-medium text-danger">{errors.code}</p> : null}
              {editing && existing.codes.length > 0 ? <p className="text-caption text-muted">A code can&apos;t be changed once saved.</p> : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
              <label className="flex flex-col gap-1 text-label font-semibold">Who
                <select value={form.firstOrderOnly ? "first" : "everyone"} onChange={(e) => set("firstOrderOnly", e.target.value === "first")} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal"><option value="everyone">Everyone</option><option value="first">First order only</option></select>
              </label>
              <TextField size="admin" label="Minimum spend (₦)" inputMode="decimal" placeholder="None" value={form.minSpend} error={errors.minSpend} onChange={(e) => set("minSpend", e.target.value)} />
              <TextField size="admin" label="Total uses" inputMode="numeric" placeholder="Unlimited" value={form.totalUses} error={errors.totalUses} onChange={(e) => set("totalUses", e.target.value)} />
              <TextField size="admin" label="Per customer" inputMode="numeric" placeholder="Unlimited" value={form.perCustomer} error={errors.perCustomer} onChange={(e) => set("perCustomer", e.target.value)} />
              <div className="col-span-full flex items-center justify-between gap-3 rounded-[18px] bg-surface-tint px-3.5 py-3">
                <span className="flex flex-col leading-[1.3]"><span className="font-bold">Can combine with other promotions</span><span className="text-caption text-muted">Off means it applies on its own, or not at all if another one already has.</span></span>
                <Switch checked={form.stackable} label="Can combine with other promotions" onChange={(v) => set("stackable", v)} />
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
                <label className="flex flex-col gap-1 text-label font-semibold">Starts (Lagos time)<input type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
                <label className="flex flex-col gap-1 text-label font-semibold">Ends (Lagos time)<input type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} aria-invalid={errors.endsAt ? true : undefined} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
              </div>
              {errors.startsAt || errors.endsAt ? <p role="alert" className="text-caption font-medium text-danger">{errors.startsAt ?? errors.endsAt}</p> : <p className="text-caption text-muted">Leave the start empty to begin as soon as it is switched on, and the end empty to run until you stop it.</p>}
              {editing && existing.stats.redemptions > 0 ? <p className="rounded-lg bg-surface-tint px-3 py-2 text-body-sm">So far: {existing.stats.redemptions} {existing.stats.redemptions === 1 ? "use" : "uses"}, {formatNaira(existing.stats.discountMinor)} given off, {formatNaira(existing.stats.orderRevenueMinor)} in orders.</p> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2 border-t border-line-soft pt-3">
            <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
            <div className="flex flex-wrap gap-2">
              {step === 3 && !editing && canWrite ? <Button variant="outline" loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>Save as draft</Button> : null}
              {step < 3 ? <Button onClick={() => setStep((s) => s + 1)}>Next</Button> : canWrite ? (
                <Button loading={save.isPending && save.variables !== false} disabled={save.isPending} onClick={() => submit(!editing)}>{submitLabel(form, editing, now)}</Button>
              ) : null}
              {editing && step < 3 && canWrite ? <Button variant="dark" loading={save.isPending} disabled={save.isPending || !dirty} onClick={() => submit(false)}>Save changes</Button> : null}
            </div>
          </div>
          {editing && canWrite && existing.promotion.lifecycle !== "ended" ? <ActivationRow detail={existing} /> : null}
        </section>

        <Preview form={form} collections={collections} lookups={lookups} />
      </div>
    </>
  );
}

const FIELD_LABEL = { percent: "Percent off", amount: "Amount off in naira", buy: "How many to buy", get: "How many free", percentOff: "Percent off", scope: "Which products" } as const;

/** Switch an existing promotion on or off without leaving the editor. */
function ActivationRow({ detail }: { detail: PromotionDetail }) {
  const queryClient = useQueryClient();
  const on = detail.promotion.status === "active";
  const toggle = useMutation({
    mutationFn: (next: boolean) => setPromotionActive(detail.promotion.id, next),
    onSuccess: (_d, next) => { toast.success(next ? "Switched on" : "Switched off"); void queryClient.invalidateQueries({ queryKey: adminKeys.resource("promotions") }); },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] bg-surface-tint px-3.5 py-3">
      <span className="flex flex-col leading-[1.3]"><span className="font-bold">{on ? "On" : "Off"}</span><span className="text-caption text-muted">{on ? "Customers can get it within its dates." : "Customers can't get it until you switch it on."}</span></span>
      <Switch checked={on} label="Promotion on" disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
    </div>
  );
}

/** What customers will see, from the same rule: the announcement bar and the bag. */
function Preview({ form, collections, lookups }: { form: PromoForm; collections: Collection[]; lookups: Lookups }) {
  const bag = bagPreview(form);
  return (
    <aside aria-label="Preview" className="flex w-full max-w-[280px] flex-[0_0_280px] flex-col gap-2.5 self-start rounded-[28px] border-[6px] border-surface-inverse bg-surface p-2.5 max-lg:max-w-none max-lg:flex-1">
      <p className="rounded-[14px] bg-surface-inverse px-3 py-2 text-center text-caption font-bold text-on-inverse">{announcementText(form, collections, lookups)}</p>
      <div className="rounded-[16px] bg-surface-tint p-3">
        <p className="text-micro font-extrabold tracking-[0.6px] text-primary-strong">IN THE BAG</p>
        <div className="mt-1 flex items-baseline justify-between gap-2 text-body-sm"><span className="font-semibold">Sample wig × {bag.quantity}</span><span className={cn(bag.discount && "text-muted line-through")}>{bag.subtotal}</span></div>
        {bag.discount ? <p className="flex justify-between text-body-sm font-semibold text-success"><span>{bag.discount.label}</span><span>{bag.discount.value}</span></p> : null}
        <p className="mt-1 flex justify-between border-t border-dashed border-line pt-1 font-extrabold"><span>Total</span><span>{bag.total}</span></p>
      </div>
      <p className="text-center text-caption text-muted">A made-up example, to show how the rule reads.</p>
    </aside>
  );
}
