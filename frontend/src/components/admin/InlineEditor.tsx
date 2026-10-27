"use client";

import { Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";

type Props = {
  label: string;
  value: string;
  /** Saves the new value; throw to refuse it (the message is shown and the editor stays open). */
  onSave: (value: string) => Promise<void>;
  /** Returns a message if the value is not acceptable. */
  validate?: (value: string) => string | undefined;
  disabled?: boolean;
};

/** A value shown as text that turns into a field when its pencil is pressed: edit one thing without opening a form. */
export function InlineEditor({ label, value, onSave, validate, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate?.(draft);
    if (problem) return setError(problem);
    if (draft === value) return setEditing(false);
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
      setError(undefined);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-caption font-semibold text-muted">{label}</p><p className="truncate text-body-sm font-semibold">{value || "—"}</p></div>
        {!disabled ? <button type="button" aria-label={`Edit ${label}`} onClick={() => { setDraft(value); setError(undefined); setEditing(true); }} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-tint text-primary-strong"><Pencil aria-hidden="true" size={14} /></button> : null}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <TextField size="admin" label={label} value={draft} error={error} autoFocus onChange={(e) => { setDraft(e.target.value); setError(undefined); }} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
      <div className="flex gap-2"><Button type="submit" size="sm" loading={busy}>Save</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>
    </form>
  );
}
