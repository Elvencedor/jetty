"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../PageHeader";
import { EntrySection } from "./EntrySection";
import { PagesTab } from "./PagesTab";
import { ProductsRow } from "./ProductsRow";
import { Button, Segmented, Skeleton } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { permits } from "@/lib/admin/permissions";
import { mergeLayout, moveMessage, moveSection, SECTION_META, showingText, toggleSection } from "@/lib/admin/storefront";
import { useUrlState } from "@/lib/admin/useUrlState";
import { createContent, listContent, updateContent, type ContentEntry, type LayoutSection } from "@/lib/api/admin-content";
import { cn } from "@/lib/cn";
import { useAdminSession } from "@/lib/stores/session";
import { toast } from "@/lib/stores/toast";

const TABS = [{ value: "homepage", label: "Homepage" }, { value: "pages", label: "Pages" }] as const;
type RowKey = keyof typeof SECTION_META;

/**
 * The storefront editor, reduced to what the API can do today: arrange the home page's blocks (order and visibility are
 * saved at once, with Undo), fill each block in, publish or take down each item on its own, and edit the info pages.
 * There is no live preview, draft-wide publish or history yet.
 */
export function StorefrontPage() {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canWrite = permits(held, "content:write");
  const [tabParam, setTab] = useUrlState("tab");
  const tab = TABS.find((t) => t.value === tabParam)?.value ?? "homepage";

  return (
    <>
      <PageHeader title="Storefront" subtitle="Arrange the home page and edit your pages." />
      <Segmented mode="tabs" label="Storefront sections" className="self-start" items={TABS.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={(v) => setTab(v === "homepage" ? null : v)} />
      {tab === "homepage" ? <Homepage canWrite={canWrite} /> : <PagesTab canWrite={canWrite} />}
    </>
  );
}

function Homepage({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [selectedParam, setSelected] = useUrlState("section");
  const selected: RowKey = selectedParam && selectedParam in SECTION_META ? (selectedParam as RowKey) : "announcement";
  const [announce, setAnnounce] = useState("");

  const key = adminKeys.list("content", { type: "home_layout" });
  const layout = useQuery({ queryKey: key, queryFn: ({ signal }) => listContent({ type: "home_layout" }, { signal }), staleTime: 0 });
  const entry: ContentEntry | undefined = layout.data?.find((e) => e.status === "published");
  const sections = layout.data ? mergeLayout((entry?.body.sections as LayoutSection[] | undefined) ?? null) : null;

  const save = useMutation({
    mutationFn: async (next: LayoutSection[]) => (entry ? updateContent(entry.id, { body: { sections: next } }) : createContent({ contentType: "home_layout", title: "Home layout", body: { sections: next }, status: "published" })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.resource("content") }),
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  function apply(next: LayoutSection[], message: string, previous: LayoutSection[]) {
    setAnnounce(message);
    save.mutate(next, { onSuccess: () => toast.success(message, { label: "Undo", onClick: () => save.mutate(previous) }) });
  }
  const move = (index: number, by: -1 | 1) => {
    if (!sections) return;
    const next = moveSection(sections, index, by);
    apply(next, moveMessage(SECTION_META[sections[index]!.type].name, index + by + 1, sections.length), sections);
  };
  const toggle = (index: number) => {
    if (!sections) return;
    const next = toggleSection(sections, index);
    apply(next, `${SECTION_META[sections[index]!.type].name} ${next[index]!.enabled ? "is showing" : "is hidden from customers"}`, sections);
  };

  const meta = SECTION_META[selected];
  const index = sections?.findIndex((s) => s.type === selected) ?? -1;
  const current = index >= 0 ? sections![index] : undefined;

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label="Homepage sections" className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 rounded-card border border-line bg-surface p-4">
        <div><h2 className="font-display text-heading-xs font-extrabold">Homepage sections</h2><p className="text-caption text-muted">{sections ? showingText(sections, true) : " "} · top to bottom, as customers see it. Use the arrows to move one.</p></div>
        <p role="status" className="sr-only">{announce}</p>
        {layout.isError && !sections ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger"><span>{adminErrorMessage(layout.error)}</span><Button size="sm" variant="outline" onClick={() => void layout.refetch()}>Retry</Button></div>
        ) : !sections ? <Skeleton className="h-64" /> : (
          <ol className="flex flex-col gap-1.5">
            <Row name={SECTION_META.announcement.name} note="Always at the top" selected={selected === "announcement"} onSelect={() => setSelected(null)} />
            {sections.map((s, i) => (
              <Row
                key={s.type}
                name={SECTION_META[s.type].name}
                note={s.enabled ? SECTION_META[s.type].help : "Hidden from customers"}
                hidden={!s.enabled}
                selected={selected === s.type}
                onSelect={() => setSelected(s.type)}
                controls={canWrite ? (
                  <>
                    <IconButton label={`Move ${SECTION_META[s.type].name} up`} disabled={i === 0 || save.isPending} onClick={() => move(i, -1)}><ArrowUp aria-hidden="true" size={15} /></IconButton>
                    <IconButton label={`Move ${SECTION_META[s.type].name} down`} disabled={i === sections.length - 1 || save.isPending} onClick={() => move(i, 1)}><ArrowDown aria-hidden="true" size={15} /></IconButton>
                    <IconButton label={`${s.enabled ? "Hide" : "Show"} ${SECTION_META[s.type].name}`} disabled={save.isPending} onClick={() => toggle(i)}>{s.enabled ? <Eye aria-hidden="true" size={15} /> : <EyeOff aria-hidden="true" size={15} />}</IconButton>
                  </>
                ) : null}
              />
            ))}
          </ol>
        )}
      </section>

      <section aria-label={meta.name} className="flex min-w-0 flex-[2_1_420px] flex-col gap-3.5 rounded-card border border-line bg-surface p-5">
        <div>
          <h2 className="font-display text-heading-sm font-extrabold">{meta.name}</h2>
          <p className="text-body-sm text-muted">{meta.help}</p>
          {current && !current.enabled ? <p role="status" className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-body-sm text-warning">This block is hidden, so customers don&apos;t see it. Use the eye in the list to show it.</p> : null}
        </div>
        {meta.kind === "auto" ? <p className="rounded-lg bg-surface-tint px-3 py-2.5 text-body-sm">{meta.automatic}</p> : meta.kind === "featured_products" ? <ProductsRow canWrite={canWrite} /> : <EntrySection key={meta.kind} type={meta.kind} canWrite={canWrite} />}
        <p className="border-t border-line-soft pt-3 text-caption text-muted">Each item stays a draft until you publish it. Moving or hiding a block takes effect at once, and the toast has an Undo.</p>
      </section>
    </div>
  );
}

function Row({ name, note, selected, hidden, onSelect, controls }: { name: string; note: string; selected: boolean; hidden?: boolean; onSelect: () => void; controls?: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-1.5 rounded-[16px] border-2 p-2", selected ? "border-primary bg-surface-tint" : hidden ? "border-dashed border-line bg-surface-subtle" : "border-line bg-surface")}>
      <button type="button" aria-current={selected ? "true" : undefined} onClick={onSelect} className="flex min-w-0 flex-1 flex-col px-1.5 text-left leading-[1.3]">
        <span className={cn("font-bold", hidden && "text-muted")}>{name}</span>
        <span className="truncate text-caption text-muted">{note}</span>
      </button>
      {controls}
    </li>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-tint text-ink hover:bg-surface-blush disabled:opacity-40">{children}</button>;
}
