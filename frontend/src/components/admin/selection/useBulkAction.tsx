"use client";

import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { countText, type Noun } from "./SelectionControls";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { toast } from "@/lib/stores/toast";

/** What a bulk change reports for each thing it was asked about. */
export type BulkOutcome = {
  updated: { id: string }[];
  /** Already the way it was asked to be: nothing was written. */
  unchanged: string[];
  skipped: { id: string; title?: string; reason: string }[];
  /** No longer exists. */
  missing: string[];
};

type Plan = { title: string; body: ReactNode; confirmLabel: string; tone?: "primary" | "danger" };

type Options<T, R extends BulkOutcome> = {
  noun: Noun;
  ids: string[];
  /** Asks the admin to confirm: what will happen to how many. */
  plan: (target: T, count: number) => Plan;
  run: (ids: string[], target: T) => Promise<R>;
  /** The toast line for what was done. */
  summary: (target: T, outcome: R) => string;
  /** Puts back what an action changed. When given, the success message offers Undo. */
  undo?: (outcome: R) => Promise<unknown>;
  /** Takes finished items out of the selection (changed, already so, or gone); skipped ones stay, so they can be seen. */
  deselect: (ids: string[]) => void;
  onChanged: () => void;
  /** Called with the reasons items were skipped, so the page can point them out. */
  onSkipped?: (skipped: BulkOutcome["skipped"]) => void;
};

/**
 * One bulk action from end to end: confirm (saying how many and what happens), run it as one request, then report what
 * happened to each item, with an Undo for what changed. Finished items leave the selection; the ones that could not be
 * changed stay selected with the reason, so the admin can fix them and try again.
 */
export function useBulkAction<T, R extends BulkOutcome>(options: Options<T, R>) {
  const { noun, ids } = options;
  const [asking, setAsking] = useState<{ target: T; plan: Plan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<BulkOutcome["skipped"] | null>(null);

  const request = (target: T) => setAsking({ target, plan: options.plan(target, ids.length) });

  async function confirm() {
    if (!asking) return;
    const { target } = asking;
    setBusy(true);
    try {
      const outcome = await options.run(ids, target);
      options.deselect([...outcome.updated.map((u) => u.id), ...outcome.unchanged, ...outcome.missing]);
      options.onChanged();
      setAsking(null);
      const undo = options.undo;
      const lines = [options.summary(target, outcome)];
      if (outcome.unchanged.length > 0) lines.push(`${countText(outcome.unchanged.length, noun)} already ${outcome.unchanged.length === 1 ? "was" : "were"} that way.`);
      if (outcome.missing.length > 0) lines.push(`${countText(outcome.missing.length, noun)} no longer ${outcome.missing.length === 1 ? "exists" : "exist"}.`);
      if (outcome.skipped.length > 0) lines.push(`${outcome.skipped.length} could not be changed.`);
      const message = lines.join(" ");
      if (undo && outcome.updated.length > 0) {
        toast.success(message, { label: "Undo", onClick: () => void undo(outcome).then(() => { options.onChanged(); toast.success("Undone."); }, (err) => toast.error(adminErrorMessage(err))) });
      } else {
        toast.success(message);
      }
      if (outcome.skipped.length > 0) {
        setSkipped(outcome.skipped);
        options.onSkipped?.(outcome.skipped);
      }
    } catch (err) {
      toast.error(adminErrorMessage(err));
      setAsking(null);
    } finally {
      setBusy(false);
    }
  }

  const dialogs = (
    <>
      <ConfirmDialog open={!!asking} title={asking?.plan.title ?? ""} confirmLabel={asking?.plan.confirmLabel ?? "Confirm"} tone={asking?.plan.tone ?? "primary"} busy={busy} onCancel={() => setAsking(null)} onConfirm={() => void confirm()}>
        {asking?.plan.body}
      </ConfirmDialog>
      <ConfirmDialog open={!!skipped} title={`${skipped?.length ?? 0} could not be changed`} confirmLabel="Keep them selected" cancelLabel="Clear them" onCancel={() => { options.deselect((skipped ?? []).map((s) => s.id)); setSkipped(null); }} onConfirm={() => setSkipped(null)}>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {(skipped ?? []).map((s) => (
            <li key={s.id} className="flex flex-col leading-[1.3]"><span className="font-semibold">{s.title ?? s.id}</span><span className="text-caption text-danger">{s.reason}</span></li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );

  return { request, busy, dialogs };
}
