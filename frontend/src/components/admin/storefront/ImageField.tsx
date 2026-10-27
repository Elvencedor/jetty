"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button, Media, TextField } from "@/components/ui";
import { uploadContentImage } from "@/lib/admin/upload";

type Props = { label: string; hint: string; objectKey: string; url: string; alt: string; altError: string | undefined; disabled?: boolean; onChange: (next: { imageKey: string; imageUrl: string; imageAlt: string }) => void };

/** A picture for a hero card, circle or tile: choose a file, watch it upload, see it, describe it, or remove it. */
export function ImageField({ label, hint, objectKey, url, alt, altError, disabled, onChange }: Props) {
  const inputId = useId();
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string>();

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(undefined);
    setProgress(0);
    try {
      const { objectKey: key } = await uploadContentImage(file, setProgress);
      // The preview is the file on this computer until the saved version has a URL of its own.
      onChange({ imageKey: key, imageUrl: URL.createObjectURL(file), imageAlt: alt });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The upload failed. Try again.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-1 text-label font-semibold">{label}</legend>
      <div className="flex items-center gap-3">
        {objectKey ? <Media image={url ? { url } : null} alt="" aspect="4 / 5" sizes="80px" className="w-20 shrink-0 rounded-[14px]" /> : (
          <span aria-hidden="true" className="flex h-24 w-20 shrink-0 items-center justify-center rounded-[14px] border-2 border-dashed border-line-accent text-primary-strong"><ImageUp size={22} /></span>
        )}
        <div className="flex flex-col gap-1.5">
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={disabled || progress !== null} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} className="sr-only" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={disabled} loading={progress !== null} onClick={() => document.getElementById(inputId)?.click()}>{objectKey ? "Change picture" : "Add a picture"}</Button>
            {objectKey && !disabled ? <Button size="sm" variant="danger-soft" iconLeft={<Trash2 aria-hidden="true" size={14} />} onClick={() => onChange({ imageKey: "", imageUrl: "", imageAlt: "" })}>Remove<span className="sr-only"> picture</span></Button> : null}
          </div>
          <p className="text-caption text-muted">{progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : hint}</p>
        </div>
      </div>
      {problem ? <p role="alert" className="text-caption font-medium text-danger">{problem}</p> : null}
      {objectKey ? <TextField size="admin" label="What the picture shows" value={alt} error={altError} disabled={disabled} onChange={(e) => onChange({ imageKey: objectKey, imageUrl: url, imageAlt: e.target.value })} hint="Read out to people who can't see it, like “Woman wearing a 24 inch frontal”" /> : null}
    </fieldset>
  );
}
