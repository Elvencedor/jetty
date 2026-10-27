"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SideDrawer } from "../SideDrawer";
import { Prose } from "@/components/content/Prose";
import { Button, EmptyState, Segmented, Skeleton, StatusPill, TextareaField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { entryStatus } from "@/lib/admin/storefront";
import { listContent, updateContent, type ContentEntry } from "@/lib/api/admin-content";
import { formatRelativeOrAbsolute } from "@/lib/format";
import { toast } from "@/lib/stores/toast";

/** The info pages (returns, delivery, terms…): edit the title and the text, with a preview of how it reads, and publish. */
export function PagesTab({ canWrite }: { canWrite: boolean }) {
  const key = adminKeys.list("content", { type: "page" });
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => listContent({ type: "page" }, { signal }), staleTime: 0 });
  const [open, setOpen] = useState<ContentEntry | null>(null);
  const pages = (list.data ?? []).filter((p) => p.status !== "archived").sort((a, b) => a.title.localeCompare(b.title));

  return (
    <section aria-label="Pages" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <div><h2 className="font-display text-heading-xs font-extrabold">Pages</h2><p className="text-body-sm text-muted">Returns, delivery, terms and the rest. Edits go live when you publish.</p></div>
      {list.isError && !list.data ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger"><span>{adminErrorMessage(list.error)}</span><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></div>
        : !list.data ? <Skeleton className="h-40" /> : pages.length === 0 ? <EmptyState title="No pages yet">Pages you add will show up here.</EmptyState> : (
          <ul>
            {pages.map((p) => {
              const s = entryStatus(p);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3 last:border-0">
                  <span className="flex min-w-0 flex-[1_1_200px] flex-col leading-[1.3]"><span className="font-bold">{p.title}</span><span className="text-caption text-muted">/{p.slug}{p.updatedAt ? ` · edited ${formatRelativeOrAbsolute(p.updatedAt)}` : ""}</span></span>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                  <Button size="sm" variant="outline" onClick={() => setOpen(p)}>{canWrite ? "Edit" : "View"}<span className="sr-only"> {p.title}</span></Button>
                </li>
              );
            })}
          </ul>
        )}
      {open ? <PageEditor page={open} canWrite={canWrite} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function PageEditor({ page, canWrite, onClose }: { page: ContentEntry; canWrite: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(page.title);
  const [markdown, setMarkdown] = useState(String(page.body.markdown ?? ""));
  const [view, setView] = useState<"write" | "preview">("write");
  const [problem, setProblem] = useState<string>();
  const dirty = title !== page.title || markdown !== String(page.body.markdown ?? "");

  const save = useMutation({
    mutationFn: (publish: boolean) => updateContent(page.id, { title: title.trim(), body: { markdown }, ...(publish ? { status: "published" as const } : {}) }),
    onSuccess: (saved) => {
      toast.success(saved.status === "published" ? "Saved and published" : "Saved");
      void queryClient.invalidateQueries({ queryKey: adminKeys.resource("content") });
      onClose();
    },
    onError: (err) => setProblem(adminErrorMessage(err)),
  });
  const invalid = !title.trim() ? "Give the page a title" : !markdown.trim() ? "Write something for the page" : undefined;

  return (
    <SideDrawer
      open
      onClose={onClose}
      title={page.title}
      subtitle={`/${page.slug}`}
      dirty={dirty}
      footer={canWrite ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" loading={save.isPending && save.variables === false} disabled={!dirty || !!invalid || save.isPending} onClick={() => save.mutate(false)}>Save</Button>{page.status !== "published" || dirty ? <Button loading={save.isPending && save.variables === true} disabled={!!invalid || save.isPending} onClick={() => save.mutate(true)}>Save and publish</Button> : null}</> : undefined}
    >
      <div className="flex flex-col gap-3.5">
        {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{problem}</p> : null}
        <TextField size="admin" label="Page title" value={title} disabled={!canWrite} onChange={(e) => { setTitle(e.target.value); setProblem(undefined); }} />
        <Segmented mode="tabs" label="Write or preview" items={[{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }]} value={view} onChange={setView} />
        {view === "write" ? (
          <TextareaField size="admin" label="Text" rows={16} value={markdown} disabled={!canWrite} onChange={(e) => { setMarkdown(e.target.value); setProblem(undefined); }} hint="Use # for a heading, ** for bold, - for a list, [text](link) for a link." className="font-mono text-body-sm" />
        ) : (
          <div role="tabpanel" aria-label="Preview of the page" className="rounded-lg border border-line p-4"><Prose>{markdown || "Nothing to preview yet."}</Prose></div>
        )}
        {invalid && dirty ? <p role="alert" className="text-caption font-medium text-danger">{invalid}</p> : null}
      </div>
    </SideDrawer>
  );
}
