"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, SelectField, TextareaField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { emptyEntry, entryToForm, entryToPayload, MAIN_LIMIT, TONES, validateEntry, type EntryErrors, type EntryForm } from "@/lib/admin/storefront";
import { listAdminPromotions } from "@/lib/api/admin-promotions";
import { createContent, updateContent, type ContentEntry, type ContentType } from "@/lib/api/admin-content";
import { cn } from "@/lib/cn";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";

const LABELS: Partial<Record<ContentType, { main: string; link: string; hint?: string }>> = {
  announcement: { main: "Message", link: "Links to", hint: "Shown across the top of the shop" },
  banner: { main: "Headline", link: "Button goes to", hint: "Short reads best on phones" },
  story: { main: "Title", link: "Goes to" },
  tile: { main: "Title", link: "Goes to" },
  flash: { main: "Headline (optional)", link: "" },
};

type Props = { type: ContentType; entry: ContentEntry | null; nextSortOrder: number; onDone: (saved: ContentEntry) => void; onCancel: () => void };

/** One announcement, hero card, story circle, tile or flash strip: plain-language fields, a schedule, and Save or Save and publish. */
export function EntryFormPanel({ type, entry, nextSortOrder, onDone, onCancel }: Props) {
  const [original] = useState(() => (entry ? entryToForm(entry) : emptyEntry()));
  const [form, setForm] = useState<EntryForm>(original);
  const [errors, setErrors] = useState<EntryErrors>({});
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useUnsavedGuard(dirty);
  const labels = LABELS[type]!;
  const limit = MAIN_LIMIT[type];
  const set = <K extends keyof EntryForm>(k: K, v: EntryForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k === "main" ? "main" : k]: undefined })); setProblem(undefined); };

  const promotions = useQuery({ queryKey: ["admin", "promotions", "for-flash"], queryFn: ({ signal }) => listAdminPromotions({ limit: 100 }, { signal }), enabled: type === "flash", staleTime: 60_000 });

  async function submit(publish: boolean) {
    const found = validateEntry(type, form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(publish ? "publish" : "save");
    setProblem(undefined);
    try {
      const payload = entryToPayload(type, form);
      const status = publish ? ("published" as const) : undefined;
      const saved = entry
        ? await updateContent(entry.id, { ...payload, ...(status ? { status } : {}) })
        : await createContent({ contentType: type, ...payload, status: status ?? "draft", sortOrder: nextSortOrder });
      onDone(saved);
    } catch (err) {
      setProblem(adminErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const count = form.main.trim().length;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(false); }} className="flex flex-col gap-3.5">
      {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{problem}</p> : null}

      {type === "flash" ? (
        <SelectField size="admin" label="Which promotion?" value={form.promotionId} error={errors.promotionId} onChange={(e) => set("promotionId", e.target.value)} hint="The countdown and wording come from the promotion. The strip hides itself when it ends.">
          <option value="">{promotions.isPending ? "Loading…" : "Choose a promotion"}</option>
          {promotions.data?.data.filter((p) => p.status !== "ended").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      ) : null}

      {type === "announcement" ? (
        <TextareaField size="admin" label={labels.main} rows={2} value={form.main} error={errors.main} onChange={(e) => set("main", e.target.value)} hint={`${count} / ${limit} characters. ${labels.hint}`} />
      ) : (
        <TextField size="admin" label={labels.main} value={form.main} error={errors.main} onChange={(e) => set("main", e.target.value)} hint={limit ? `${count} / ${limit} characters.${labels.hint ? ` ${labels.hint}.` : ""}` : labels.hint} />
      )}

      {type === "banner" || type === "tile" ? <TextField size="admin" label={type === "banner" ? "Small text above the headline" : "Smaller line"} value={type === "banner" ? form.tag : form.secondary} onChange={(e) => set(type === "banner" ? "tag" : "secondary", e.target.value)} /> : null}
      {type === "banner" ? <TextField size="admin" label="Line under the headline" value={form.secondary} onChange={(e) => set("secondary", e.target.value)} /> : null}

      {type === "banner" || type === "tile" ? (
        <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-label font-semibold">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button key={t.value} type="button" aria-pressed={form.tone === t.value} onClick={() => set("tone", t.value)} className={cn("h-9 rounded-pill border-2 px-3.5 font-semibold", form.tone === t.value ? "border-primary bg-surface-tint text-primary-strong" : "border-line-strong bg-surface text-ink")}>{t.label}</button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {type === "banner" ? <TextField size="admin" label="Button text" value={form.linkLabel} error={errors.linkLabel} onChange={(e) => set("linkLabel", e.target.value)} /> : null}
      {type === "announcement" ? <TextField size="admin" label="Link text (optional)" value={form.linkLabel} onChange={(e) => set("linkLabel", e.target.value)} /> : null}
      {type !== "flash" ? <TextField size="admin" label={labels.link} value={form.linkUrl} error={errors.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} placeholder="/shop" hint="A page on your shop like /shop, or a full https:// link" /> : null}

      {type === "story" ? (
        <label className="flex items-center gap-2 text-body-sm font-semibold"><input type="checkbox" checked={form.highlight} onChange={(e) => set("highlight", e.target.checked)} className="size-[18px] accent-primary" />Highlight this circle</label>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <label className="flex flex-col gap-1 text-label font-semibold">Show from (Lagos time)<input type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
        <label className="flex flex-col gap-1 text-label font-semibold">Hide after (Lagos time)<input type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} aria-invalid={errors.endsAt ? true : undefined} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      </div>
      {errors.startsAt || errors.endsAt ? <p role="alert" className="text-caption font-medium text-danger">{errors.startsAt ?? errors.endsAt}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={!!busy}>Cancel</Button>
        <Button type="submit" variant="outline" loading={busy === "save"} disabled={!!busy || (!dirty && !!entry)}>{entry ? "Save changes" : "Save as draft"}</Button>
        {!entry || entry.status !== "published" ? <Button loading={busy === "publish"} disabled={!!busy} onClick={() => void submit(true)}>{entry ? "Save and publish" : "Publish"}</Button> : null}
      </div>
    </form>
  );
}
