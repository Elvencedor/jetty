"use client";

import { useState } from "react";
import { SelectField, TextField, TextareaField } from "@/components/ui";
import { STATUS_CHOICES, type Basics } from "@/lib/admin/productForm";
import type { AdminCategory, AdminProductStatus } from "@/lib/api/admin-catalog";

type Props = {
  basics: Basics;
  originalStatus: AdminProductStatus;
  categories: AdminCategory[];
  titleError?: string | undefined;
  disabled: boolean;
  onChange: (patch: Partial<Basics>) => void;
};

const DETAIL_TABS = [["details", "Details"], ["fit", "Fit"], ["care", "Care"], ["delivery", "Delivery"]] as const;

/** Title, description, category and status; the search listing and the product page's text tabs sit in folded sections. */
export function BasicsTab({ basics, originalStatus, categories, titleError, disabled, onChange }: Props) {
  const [seoOpen, setSeoOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 p-4">
      <TextField size="admin" label="Title" value={basics.title} error={titleError} disabled={disabled} onChange={(e) => onChange({ title: e.target.value })} className="min-h-[46px]" />
      <TextareaField size="admin" label="Description" rows={4} value={basics.description} disabled={disabled} onChange={(e) => onChange({ description: e.target.value })} />
      <div className="grid grid-cols-2 gap-2.5">
        <SelectField size="admin" label="Category" value={basics.categoryId} disabled={disabled} onChange={(e) => onChange({ categoryId: e.target.value })}>
          <option value="">None</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inactive)"}</option>)}
        </SelectField>
        <SelectField size="admin" label="Status" value={basics.status} disabled={disabled} onChange={(e) => onChange({ status: e.target.value as AdminProductStatus })}>
          {STATUS_CHOICES[originalStatus].map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </SelectField>
      </div>

      <Fold title="Product page text" open={textOpen} onToggle={() => setTextOpen((o) => !o)} hint="Shown in the Details, Fit, Care and Delivery tabs. Markdown works.">
        {DETAIL_TABS.map(([key, label]) => (
          <TextareaField key={key} size="admin" label={label} rows={3} value={basics.details[key]} disabled={disabled} onChange={(e) => onChange({ details: { ...basics.details, [key]: e.target.value } })} />
        ))}
      </Fold>
      <Fold title="Search engine listing" open={seoOpen} onToggle={() => setSeoOpen((o) => !o)} hint="How the product appears on Google. Leave blank to use the title and description.">
        <TextField size="admin" label="Page title" value={basics.seoTitle} disabled={disabled} maxLength={120} onChange={(e) => onChange({ seoTitle: e.target.value })} />
        <TextareaField size="admin" label="Page description" rows={3} value={basics.seoDescription} disabled={disabled} maxLength={300} onChange={(e) => onChange({ seoDescription: e.target.value })} />
      </Fold>
    </div>
  );
}

function Fold({ title, hint, open, onToggle, children }: { title: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line">
      <h3><button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 text-left font-bold">{title}<span aria-hidden="true" className="text-muted">{open ? "−" : "+"}</span></button></h3>
      {open ? <div className="flex flex-col gap-3 px-3.5 pb-3.5"><p className="text-caption text-muted">{hint}</p>{children}</div> : null}
    </section>
  );
}
