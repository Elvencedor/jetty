"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { EntryFormPanel } from "./EntryForm";
import { Button, Skeleton, StatusPill } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { entryStatus, moveEntry } from "@/lib/admin/storefront";
import { listContent, updateContent, type ContentEntry, type ContentType } from "@/lib/api/admin-content";
import { toast } from "@/lib/stores/toast";

const ORDERABLE: ContentType[] = ["banner", "story", "tile"];
const NOUN: Partial<Record<ContentType, string>> = { announcement: "message", banner: "hero card", story: "story circle", tile: "category tile", flash: "flash strip" };

const summary = (e: ContentEntry) => {
  const b = e.body;
  return String(b.text ?? b.headline ?? b.title ?? e.title);
};

/** The entries of one kind: add, edit, publish or take down, archive, and (for cards, circles and tiles) reorder. */
export function EntrySection({ type, canWrite }: { type: ContentType; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const key = adminKeys.list("content", { type });
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => listContent({ type }, { signal }), staleTime: 0 });
  const [editing, setEditing] = useState<ContentEntry | "new" | null>(null);
  const [archiving, setArchiving] = useState<ContentEntry | null>(null);
  const noun = NOUN[type] ?? "entry";
  const entries = (list.data ?? []).filter((e) => e.status !== "archived").sort((a, b) => a.sortOrder - b.sortOrder || (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: adminKeys.resource("content") });

  const change = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateContent>[1] }) => updateContent(id, patch),
    onSuccess: refresh,
    onError: (err) => toast.error(adminErrorMessage(err)),
  });
  const move = useMutation({
    mutationFn: async ({ id, by }: { id: string; by: -1 | 1 }) => {
      const next = moveEntry(entries, id, by);
      await Promise.all(next.map((e, i) => (e.sortOrder === i * 10 ? null : updateContent(e.id, { sortOrder: i * 10 }))));
    },
    onSuccess: refresh,
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  if (editing) {
    return (
      <EntryFormPanel
        type={type}
        entry={editing === "new" ? null : editing}
        nextSortOrder={(entries.at(-1)?.sortOrder ?? -10) + 10}
        onCancel={() => setEditing(null)}
        onDone={(saved) => { setEditing(null); refresh(); toast.success(saved.status === "published" ? `Published. It's on the shop${saved.startsAt && Date.parse(saved.startsAt) > Date.now() ? " from its start time" : ""}.` : "Saved as a draft. Publish it when it is ready."); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {list.isError && !list.data ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger"><span>{adminErrorMessage(list.error)}</span><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></div>
      ) : !list.data ? <Skeleton className="h-32" /> : entries.length === 0 ? (
        <p className="rounded-lg bg-surface-tint px-3 py-2.5 text-body-sm text-ink-soft">Nothing here yet, so this block is left out of the shop.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e, i) => {
            const s = entryStatus(e);
            return (
              <li key={e.id} className="flex flex-col gap-2 rounded-[16px] border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-semibold leading-[1.3]">{summary(e)}</span>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </div>
                {canWrite ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setEditing(e)}>Edit<span className="sr-only"> {noun}: {summary(e)}</span></Button>
                    {e.status === "published" ? <Button size="sm" variant="outline" loading={change.isPending && change.variables?.id === e.id} onClick={() => change.mutate({ id: e.id, patch: { status: "draft" } })}>Take down<span className="sr-only"> {summary(e)}</span></Button> : <Button size="sm" loading={change.isPending && change.variables?.id === e.id} onClick={() => change.mutate({ id: e.id, patch: { status: "published" } })}>Publish<span className="sr-only"> {summary(e)}</span></Button>}
                    <Button size="sm" variant="danger-soft" onClick={() => setArchiving(e)}>Remove<span className="sr-only"> {summary(e)}</span></Button>
                    {ORDERABLE.includes(type) ? (
                      <span className="ml-auto flex gap-1">
                        <button type="button" aria-label={`Move ${summary(e)} earlier`} disabled={i === 0 || move.isPending} onClick={() => move.mutate({ id: e.id, by: -1 })} className="inline-flex size-9 items-center justify-center rounded-full bg-surface-tint disabled:opacity-40"><ArrowUp aria-hidden="true" size={16} /></button>
                        <button type="button" aria-label={`Move ${summary(e)} later`} disabled={i === entries.length - 1 || move.isPending} onClick={() => move.mutate({ id: e.id, by: 1 })} className="inline-flex size-9 items-center justify-center rounded-full bg-surface-tint disabled:opacity-40"><ArrowDown aria-hidden="true" size={16} /></button>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && !(type === "flash" && entries.length > 0) ? <Button variant="add" className="self-start" iconLeft={<Plus aria-hidden="true" size={16} />} onClick={() => setEditing("new")}>Add {noun}</Button> : null}

      <ConfirmDialog open={!!archiving} title={`Remove this ${noun}?`} confirmLabel="Remove" tone="danger" busy={change.isPending} onCancel={() => setArchiving(null)} onConfirm={() => archiving && change.mutate({ id: archiving.id, patch: { status: "archived" } }, { onSuccess: () => { setArchiving(null); toast.success("Removed"); } })}>
        It disappears from the shop and from this list. Customers see the page without it straight away.
      </ConfirmDialog>
    </div>
  );
}
