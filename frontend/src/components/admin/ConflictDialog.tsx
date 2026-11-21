"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { conflictOf } from "@/lib/admin/concurrency";

type DialogProps = {
  open: boolean;
  noun: string;
  /** Null when the API did not say which version is current: then only their version can be taken. */
  canKeepMine: boolean;
  /** What you both changed, when it is known ("the name, the tags"). */
  detail?: string | undefined;
  busy: "mine" | "theirs" | null;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  onCancel: () => void;
};

/**
 * Shown only after a save was refused because someone else saved first. The admin chooses whose version stands:
 * their own edits (saved on top of what the other person saved) or the other person's (their edits are dropped).
 */
export function ConflictDialog({ open, noun, canKeepMine, detail, busy, onKeepMine, onUseTheirs, onCancel }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const working = busy !== null;
  return (
    <dialog ref={ref} aria-labelledby={titleId} // React lets a dialog's cancel and close events bubble to the dialog around it (the drawer this is shown in). They are about
      // this dialog only: left to bubble, "Keep editing" would close the drawer and throw the edits away.
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); if (!working) onCancel(); }}
      onClose={(e) => { e.stopPropagation(); if (open && !working) onCancel(); }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-card bg-surface p-0 text-ink shadow-panel backdrop:bg-scrim">
      {open ? (
        <div className="flex flex-col gap-3 p-5">
          <h2 id={titleId} className="font-display text-heading-xs font-extrabold">Someone else changed this {noun}</h2>
          <div className="flex flex-col gap-2 text-body-sm text-ink-soft">
            <p>It was saved by someone else after you opened it.{detail ? ` You both changed ${detail}.` : ""} Choose which version to keep.</p>
            <ul className="flex flex-col gap-1">
              {canKeepMine ? <li><strong>Keep my changes</strong> saves what you typed on top of their version.</li> : null}
              <li><strong>Use their version</strong> drops what you typed and shows what they saved.</li>
            </ul>
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="outline" autoFocus disabled={working} onClick={onCancel}>Keep editing</Button>
            <Button variant="outline" loading={busy === "theirs"} disabled={busy === "mine"} onClick={onUseTheirs}>Use their version</Button>
            {canKeepMine ? <Button variant="primary" loading={busy === "mine"} disabled={busy === "theirs"} onClick={onKeepMine}>Keep my changes</Button> : null}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

type Pending = { currentVersion: number | null; retry: (version: number) => Promise<unknown>; detail?: string | undefined };

/**
 * Wires a save to the conflict choice. Call `offer(err, retry)` from the save's error path: it returns true, and opens
 * the dialog, only when the error is a version conflict. `retry` saves the same edits again against the version given.
 * `onUseTheirs` drops the edits and shows what is saved now.
 */
export function useConflictChoice({ noun, onUseTheirs }: { noun: string; onUseTheirs: () => unknown }): { offer: (err: unknown, retry: (version: number) => Promise<unknown>, detail?: string) => boolean; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<"mine" | "theirs" | null>(null);

  const offer = useCallback((err: unknown, retry: (version: number) => Promise<unknown>, detail?: string) => {
    const conflict = conflictOf(err);
    if (!conflict) return false;
    setPending({ currentVersion: conflict.currentVersion, retry, detail });
    return true;
  }, []);

  async function keepMine() {
    const asked = pending;
    if (!asked || asked.currentVersion === null) return;
    setBusy("mine");
    try {
      await asked.retry(asked.currentVersion);
    } catch {
      // The save's own error path already said what went wrong, or offered the choice again with a newer version.
    } finally {
      setPending((now) => (now === asked ? null : now));
      setBusy(null);
    }
  }

  async function useTheirs() {
    setBusy("theirs");
    try {
      await onUseTheirs();
    } finally {
      setPending(null);
      setBusy(null);
    }
  }

  const dialog = <ConflictDialog open={!!pending} noun={noun} canKeepMine={pending?.currentVersion != null} detail={pending?.detail} busy={busy} onKeepMine={() => void keepMine()} onUseTheirs={() => void useTheirs()} onCancel={() => setPending(null)} />;
  return { offer, dialog };
}

type SaveOptions<Args extends unknown[], R> = {
  noun: string;
  /**
   * True when this save changes a record that already exists. Only an edit can find the record changed, so a create
   * (false) never offers the choice: whatever it fails with goes to `onError`. Defaults to true.
   */
  editing?: boolean;
  /** Saves with the version the edit was made against; `version` is undefined on the first try, the current one when keeping my changes. */
  save: (version: number | undefined, ...args: Args) => Promise<R>;
  onSaved: (result: R, ...args: Args) => void;
  /** Any failure that is not a version conflict. */
  onError: (err: unknown, ...args: Args) => void;
  /** Drops the edits and shows what is saved now. */
  onUseTheirs: (...args: Args) => unknown;
};

/**
 * A save with the conflict choice built in: `run(...args)` saves; if the API says the record moved on, the admin is asked
 * whose version stands. Everything else goes to `onError`, so the choice appears only when a save is refused.
 */
export function useConflictSave<Args extends unknown[], R>(options: SaveOptions<Args, R>) {
  const latest = useRef(options);
  latest.current = options;
  const [pending, setPending] = useState(false);
  const lastArgs = useRef<Args | null>(null);
  const choice = useConflictChoice({ noun: options.noun, onUseTheirs: () => latest.current.onUseTheirs(...(lastArgs.current ?? ([] as unknown as Args))) });
  const { offer } = choice;

  const attempt = useCallback(
    async (args: Args, version?: number): Promise<void> => {
      lastArgs.current = args;
      setPending(true);
      try {
        const result = await latest.current.save(version, ...args);
        latest.current.onSaved(result, ...args);
      } catch (err) {
        if (latest.current.editing !== false && offer(err, (v) => attempt(args, v))) return;
        latest.current.onError(err, ...args);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [offer],
  );

  const run = useCallback((...args: Args) => void attempt(args).catch(() => undefined), [attempt]);
  return { run, pending, dialog: choice.dialog };
}

/** Thrown by a save that has handed a conflict to the choice dialog, so the form it came from shows no error of its own. */
export class ConflictOffered extends Error {
  constructor() {
    super("Waiting for the admin to choose which version to keep.");
    this.name = "ConflictOffered";
  }
}
