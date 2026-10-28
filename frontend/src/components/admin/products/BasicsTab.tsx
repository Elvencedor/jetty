"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { SelectField, TextField, TextareaField } from "@/components/ui";
import { MAX_TAG_LENGTH, MAX_TAGS, STATUS_CHOICES, tidyTags, type Basics } from "@/lib/admin/productForm";
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

      <TagsField tags={basics.tags} disabled={disabled} onChange={(tags) => onChange({ tags })} />

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

/** Labels for your own organising and search ("bestseller", "summer"). Type one and press Enter or a comma. */
function TagsField({ tags, disabled, onChange }: { tags: string[]; disabled: boolean; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string>();
  function add(text: string) {
    const next = tidyTags([...tags, ...text.split(",")]);
    if (next.length === tags.length) return setDraft("");
    if (next.length > MAX_TAGS) return setProblem(`A product can have up to ${MAX_TAGS} tags`);
    if (next.some((t) => t.length > MAX_TAG_LENGTH)) return setProblem(`Keep each tag under ${MAX_TAG_LENGTH} characters`);
    setProblem(undefined);
    setDraft("");
    onChange(next);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        size="admin"
        label="Tags"
        value={draft}
        disabled={disabled}
        error={problem}
        placeholder="Add a tag and press Enter"
        hint="For your own filing and search, like bestseller or summer. Customers don't see them."
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : (setDraft(e.target.value), setProblem(undefined)))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (draft.trim()) add(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      {tags.length ? (
        <ul aria-label="Tags on this product" className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-pill bg-surface-tint py-1 pl-3 pr-1 text-label font-semibold text-primary-strong">
              {t}
              {!disabled ? <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-surface-blush"><X aria-hidden="true" size={12} /></button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
