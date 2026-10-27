"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { SideDrawer } from "../SideDrawer";
import { useDebounced } from "@/components/shell/useDebounced";
import { Button, SelectField, Switch, TextareaField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { moveId } from "@/lib/admin/storefront";
import { selfAndDescendants, slugify, validateTaxonomy, type TaxonomyErrors, type TaxonomyForm } from "@/lib/admin/taxonomy";
import { createAdminCategory, createAdminCollection, listAdminProducts, listCollectionMembers, setCollectionMembers, updateAdminCategory, updateAdminCollection, type CategoryRow, type CollectionRow } from "@/lib/api/admin-catalog";
import { toast } from "@/lib/stores/toast";

const blank = (): TaxonomyForm => ({ name: "", slug: "", sortOrder: "", active: true, parentId: "", description: "" });

function useForm(initial: TaxonomyForm) {
  const [original] = useState(initial);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<TaxonomyErrors>({});
  const [problem, setProblem] = useState<string>();
  const [slugTouched, setSlugTouched] = useState(!!initial.slug);
  const set = <K extends keyof TaxonomyForm>(k: K, v: TaxonomyForm[K]) => {
    setForm((f) => ({ ...f, [k]: v, ...(k === "name" && !slugTouched ? { slug: slugify(String(v)) } : {}) }));
    if (k === "slug") setSlugTouched(true);
    setErrors((e) => ({ ...e, [k]: undefined }));
    setProblem(undefined);
  };
  return { form, set, errors, setErrors, problem, setProblem, dirty: JSON.stringify(form) !== JSON.stringify(original) };
}

const num = (v: string) => (v.trim() ? Number(v) : undefined);

export function CategoryDrawer({ category, all, canWrite, onClose, onSaved }: { category: CategoryRow | null; all: CategoryRow[]; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const f = useForm(category ? { name: category.name, slug: category.slug, sortOrder: String(category.sortOrder), active: category.active, parentId: category.parentId ?? "", description: "" } : blank());
  const blocked = category ? selfAndDescendants(all, category.id) : new Set<string>();
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.form.name.trim(), ...(f.form.slug.trim() ? { slug: f.form.slug.trim() } : {}), sortOrder: num(f.form.sortOrder), active: f.form.active, parentId: f.form.parentId || null };
      return category ? updateAdminCategory(category.id, body) : createAdminCategory(body);
    },
    onSuccess: () => { toast.success(category ? "Category saved" : "Category created"); onSaved(); },
    onError: (err) => f.setProblem(adminErrorMessage(err)),
  });
  function submit() {
    const found = validateTaxonomy(f.form);
    f.setErrors(found);
    if (!Object.keys(found).length) save.mutate();
  }
  return (
    <SideDrawer open onClose={onClose} title={category ? `Edit ${category.name}` : "New category"} dirty={f.dirty} footer={canWrite ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!!category && !f.dirty} onClick={submit}>{category ? "Save category" : "Create category"}</Button></> : undefined}>
      <div className="flex flex-col gap-4">
        {f.problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{f.problem}</p> : null}
        <TextField size="admin" label="Name" value={f.form.name} disabled={!canWrite} error={f.errors.name} onChange={(e) => f.set("name", e.target.value)} />
        <TextField size="admin" label="Web address" prefix="/" value={f.form.slug} disabled={!canWrite} error={f.errors.slug} onChange={(e) => f.set("slug", e.target.value)} hint="Made from the name. Changing it breaks old links to this category." />
        <SelectField size="admin" label="Sits under" value={f.form.parentId} disabled={!canWrite} onChange={(e) => f.set("parentId", e.target.value)} hint="Leave on top level for a main category.">
          <option value="">Top level</option>
          {all.filter((c) => !blocked.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <TextField size="admin" label="Order" inputMode="numeric" value={f.form.sortOrder} disabled={!canWrite} error={f.errors.sortOrder} onChange={(e) => f.set("sortOrder", e.target.value)} hint="Smaller numbers come first." />
        <label className="flex items-center justify-between gap-3 rounded-lg bg-surface-tint px-3.5 py-3"><span className="flex flex-col leading-[1.3]"><span className="font-bold">Show to shoppers</span><span className="text-caption text-muted">Off hides the category from the shop menu. Its products stay.</span></span><Switch checked={f.form.active} label="Show this category to shoppers" disabled={!canWrite} onChange={(v) => f.set("active", v)} /></label>
      </div>
    </SideDrawer>
  );
}

export function CollectionDrawer({ collection, canWrite, onClose, onSaved }: { collection: CollectionRow | null; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const f = useForm(collection ? { name: collection.name, slug: collection.slug, sortOrder: String(collection.sortOrder), active: collection.active, parentId: "", description: collection.description ?? "" } : blank());
  const members = useQuery({ queryKey: adminKeys.detail("taxonomy", collection?.id ?? "new"), queryFn: ({ signal }) => listCollectionMembers(collection!.id, { signal }), enabled: !!collection, staleTime: 0 });
  const [picked, setPicked] = useState<{ id: string; title: string }[] | null>(null);
  const current = picked ?? members.data?.map((m) => ({ id: m.id, title: m.title })) ?? [];
  const original = members.data?.map((m) => m.id) ?? [];
  const membersChanged = picked !== null && JSON.stringify(picked.map((p) => p.id)) !== JSON.stringify(original);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const results = useQuery({ queryKey: adminKeys.list("products", { picker: q, status: "active" }), queryFn: ({ signal }) => listAdminProducts({ ...(q ? { q } : {}), status: "active", limit: 8 }, { signal }), enabled: canWrite, staleTime: 30_000 });

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: f.form.name.trim(), ...(f.form.slug.trim() ? { slug: f.form.slug.trim() } : {}), sortOrder: num(f.form.sortOrder), active: f.form.active, description: f.form.description.trim() || null };
      const saved = collection ? await updateAdminCollection(collection.id, body) : await createAdminCollection(body);
      if (membersChanged || (!collection && picked)) await setCollectionMembers(saved.id, current.map((p) => p.id));
      return saved;
    },
    onSuccess: () => { toast.success(collection ? "Collection saved" : "Collection created"); onSaved(); },
    onError: (err) => f.setProblem(adminErrorMessage(err)),
  });
  function submit() {
    const found = validateTaxonomy(f.form);
    f.setErrors(found);
    if (!Object.keys(found).length) save.mutate();
  }
  const edit = (next: { id: string; title: string }[]) => setPicked(next);
  const dirty = f.dirty || membersChanged;

  return (
    <SideDrawer open onClose={onClose} title={collection ? `Edit ${collection.name}` : "New collection"} dirty={dirty} footer={canWrite ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!!collection && !dirty} onClick={submit}>{collection ? "Save collection" : "Create collection"}</Button></> : undefined}>
      <div className="flex flex-col gap-4">
        {f.problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{f.problem}</p> : null}
        <TextField size="admin" label="Name" value={f.form.name} disabled={!canWrite} error={f.errors.name} onChange={(e) => f.set("name", e.target.value)} />
        <TextField size="admin" label="Web address" prefix="/" value={f.form.slug} disabled={!canWrite} error={f.errors.slug} onChange={(e) => f.set("slug", e.target.value)} />
        <TextareaField size="admin" label="Description" rows={2} value={f.form.description} disabled={!canWrite} onChange={(e) => f.set("description", e.target.value)} hint="Optional. Shown at the top of the collection page." />
        <TextField size="admin" label="Order" inputMode="numeric" value={f.form.sortOrder} disabled={!canWrite} error={f.errors.sortOrder} onChange={(e) => f.set("sortOrder", e.target.value)} hint="Smaller numbers come first." />
        <label className="flex items-center justify-between gap-3 rounded-lg bg-surface-tint px-3.5 py-3"><span className="flex flex-col leading-[1.3]"><span className="font-bold">Show to shoppers</span><span className="text-caption text-muted">Off hides the collection page. Products stay.</span></span><Switch checked={f.form.active} label="Show this collection to shoppers" disabled={!canWrite} onChange={(v) => f.set("active", v)} /></label>

        <section aria-label="Products in this collection" className="flex flex-col gap-1.5">
          <h3 className="text-label font-semibold">Products ({current.length})</h3>
          {collection && members.isPending ? <p className="text-body-sm text-muted">Loading…</p> : current.length === 0 ? <p className="text-body-sm text-muted">None yet. Add some below, in the order shoppers should see them.</p> : (
            <ol className="flex flex-col gap-1.5">
              {current.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2 rounded-[12px] border border-line bg-surface px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
                  {canWrite ? (
                    <>
                      <button type="button" aria-label={`Move ${p.title} earlier`} disabled={i === 0} onClick={() => edit(moveId(current.map((x) => x.id), p.id, -1).map((id) => current.find((x) => x.id === id)!))} className="inline-flex size-8 items-center justify-center rounded-full bg-surface-tint disabled:opacity-40"><ArrowUp aria-hidden="true" size={14} /></button>
                      <button type="button" aria-label={`Move ${p.title} later`} disabled={i === current.length - 1} onClick={() => edit(moveId(current.map((x) => x.id), p.id, 1).map((id) => current.find((x) => x.id === id)!))} className="inline-flex size-8 items-center justify-center rounded-full bg-surface-tint disabled:opacity-40"><ArrowDown aria-hidden="true" size={14} /></button>
                      <button type="button" aria-label={`Remove ${p.title}`} onClick={() => edit(current.filter((x) => x.id !== p.id))} className="inline-flex size-8 items-center justify-center rounded-full bg-danger-bg text-danger"><X aria-hidden="true" size={14} /></button>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
        {canWrite ? (
          <section aria-label="Add products" className="flex flex-col gap-2">
            <TextField size="admin" label="Find a product" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
            <ul className="flex flex-col gap-1.5">
              {results.data?.data.map((p) => {
                const added = current.some((x) => x.id === p.id);
                return <li key={p.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-subtle px-3 py-2"><span className="min-w-0 truncate">{p.title}</span><Button size="sm" variant="outline" disabled={added} onClick={() => edit([...current, { id: p.id, title: p.title }])}>{added ? "Added" : "Add"}<span className="sr-only"> {p.title}</span></Button></li>;
              })}
              {results.data && results.data.data.length === 0 ? <li className="text-body-sm text-muted">No products match.</li> : null}
            </ul>
          </section>
        ) : null}
      </div>
    </SideDrawer>
  );
}
