"use client";

import { ArrowLeft, ArrowRight, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button, Media, SelectField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import type { VariantDraft } from "@/lib/admin/matrix";
import { uploadProductImage } from "@/lib/admin/upload";
import { deleteMedia, getAdminProduct, MEDIA_ANGLES, updateMedia, type AdminMedia, type AdminProductDetail, type Versioned } from "@/lib/api/admin-catalog";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/stores/toast";
import { ConfirmDialog } from "../ConfirmDialog";

type Upload = { id: number; name: string; progress: number; error?: string };
type Props = { productId: string; media: AdminMedia[]; variants: VariantDraft[]; disabled: boolean; onSaved: (saved: Versioned<AdminProductDetail>) => void };

const label = (m: AdminMedia, index: number) => (index === 0 ? "Cover" : m.angle ? m.angle.replace(/^./, (c) => c.toUpperCase()) : `Photo ${index + 1}`);
let uploadId = 0;

/**
 * Photos in a three-column grid; the first is the cover. Drag a photo to reorder (or use the arrows on the selected
 * one), pick one to change its description and angle or remove it, and upload several at a time with progress.
 * Photos are saved as soon as they change, not with the Save button.
 */
export function MediaTab({ productId, media, disabled, onSaved }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState<{ id: string; text: string } | null>(null);
  const selectedIndex = media.findIndex((m) => m.id === selectedId);
  const selected = media[selectedIndex];

  const refresh = async () => onSaved(await getAdminProduct(productId));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const batch = Array.from(files).map((file) => ({ file, id: ++uploadId }));
    setUploads((u) => [...u, ...batch.map(({ file, id }) => ({ id, name: file.name, progress: 0 }))]);
    // A few at a time: enough to be quick, not so many that a phone connection chokes.
    const queue = [...batch];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { file, id } = item;
        try {
          await uploadProductImage(productId, file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
          setUploads((u) => u.filter((x) => x.id !== id));
        } catch (err) {
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: err instanceof Error && !("status" in err) ? err.message : adminErrorMessage(err) } : x)));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, batch.length) }, worker));
    await refresh();
    if (input.current) input.current.value = "";
  }

  /** Puts the photos in a new order, making the first the cover. Only photos whose place changed are sent. */
  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= media.length) return;
    const next = [...media];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setBusy(true);
    try {
      await Promise.all(next.flatMap((m, i) => (m.sortOrder !== i || (i === 0) !== m.isCover ? [updateMedia(productId, m.id, { sortOrder: i, ...(i === 0 ? { isCover: true } : {}) })] : [])));
      await refresh();
    } catch (err) {
      toast.error(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function patch(fields: Parameters<typeof updateMedia>[2]) {
    if (!selected) return;
    setBusy(true);
    try {
      await updateMedia(productId, selected.id, fields);
      await refresh();
    } catch (err) {
      toast.error(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteMedia(productId, selected.id);
      setSelectedId(null);
      setRemoving(false);
      await refresh();
    } catch (err) {
      toast.error(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <ul className="grid grid-cols-3 gap-2" aria-label="Photos">
        {media.map((m, i) => (
          <li
            key={m.id}
            draggable={!disabled && !busy}
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => dragFrom !== null && e.preventDefault()}
            onDrop={() => { if (dragFrom !== null) void reorder(dragFrom, i); setDragFrom(null); }}
            onDragEnd={() => setDragFrom(null)}
          >
            <button type="button" aria-pressed={m.id === selectedId} aria-label={`${label(m, i)}${m.id === selectedId ? ", selected" : ""}`} onClick={() => setSelectedId(m.id === selectedId ? null : m.id)} className={cn("relative block w-full overflow-hidden rounded-md outline-offset-2", m.id === selectedId && "outline-2 outline-primary", dragFrom === i && "opacity-50")}>
              <Media image={m.url ? { url: m.url } : null} alt={m.altText ?? ""} aspect="1 / 1" tone={i} sizes="140px" className="rounded-md" />
              <span className="absolute bottom-1.5 left-1.5 rounded-xs bg-surface/90 px-1.5 text-micro font-semibold text-primary-deep">{label(m, i)}</span>
            </button>
          </li>
        ))}
        {!disabled ? (
          <li>
            <label htmlFor={inputId} className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-[1.5px] border-dashed border-line-accent bg-surface-subtle font-semibold text-primary-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
              <Upload aria-hidden="true" size={18} /> Upload
              <input ref={input} id={inputId} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(e) => void upload(e.target.files)} />
            </label>
          </li>
        ) : null}
      </ul>
      <p className="text-caption text-muted">Drag to reorder. The first photo is the cover. Upload 24+ frames to turn on the 360° viewer.</p>

      {uploads.length ? (
        <ul aria-label="Uploads" className="flex flex-col gap-1.5">
          {uploads.map((u) => (
            <li key={u.id} className="flex flex-col gap-1 rounded-md bg-surface-subtle px-3 py-2 text-caption">
              <span className="flex justify-between gap-2"><span className="truncate font-semibold">{u.name}</span>{u.error ? null : <span>{Math.round(u.progress * 100)}%</span>}</span>
              {u.error ? <span role="alert" className="text-danger">{u.error} <button type="button" className="underline" onClick={() => setUploads((all) => all.filter((x) => x.id !== u.id))}>Dismiss</button></span> : <span aria-hidden="true" className="h-1.5 rounded-xs bg-plum-50"><span className="block h-1.5 rounded-xs bg-primary transition-[width]" style={{ width: `${u.progress * 100}%` }} /></span>}
            </li>
          ))}
        </ul>
      ) : null}

      {selected ? (
        <section aria-label="Selected photo" className="flex flex-col gap-3 rounded-lg bg-surface-tint p-3.5">
          <TextField
            size="admin"
            label="Description (read aloud to people who can't see the photo)"
            value={alt && alt.id === selected.id ? alt.text : (selected.altText ?? "")}
            disabled={disabled || busy}
            maxLength={200}
            onChange={(e) => setAlt({ id: selected.id, text: e.target.value })}
            onBlur={() => { if (alt && alt.id === selected.id && alt.text !== (selected.altText ?? "")) void patch({ altText: alt.text.trim() || null }); setAlt(null); }}
          />
          <SelectField size="admin" label="Angle" value={selected.angle ?? ""} disabled={disabled || busy} onChange={(e) => void patch({ angle: e.target.value || null })}>
            <option value="">Not set</option>
            {MEDIA_ANGLES.map((a) => <option key={a} value={a}>{a.replace(/^./, (c) => c.toUpperCase())}</option>)}
          </SelectField>
          {!disabled ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy || selectedIndex === 0} iconLeft={<ArrowLeft aria-hidden="true" size={14} />} onClick={() => void reorder(selectedIndex, selectedIndex - 1)}>Move earlier</Button>
              <Button size="sm" variant="outline" disabled={busy || selectedIndex === media.length - 1} iconRight={<ArrowRight aria-hidden="true" size={14} />} onClick={() => void reorder(selectedIndex, selectedIndex + 1)}>Move later</Button>
              <Button size="sm" variant="danger-soft" iconLeft={<Trash2 aria-hidden="true" size={14} />} onClick={() => setRemoving(true)}>Remove</Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog open={removing} title="Remove this photo?" confirmLabel="Remove photo" tone="danger" busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void remove()}>
        It disappears from the product page straight away.
      </ConfirmDialog>
    </div>
  );
}
