"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { FormSection } from "../FormSection";
import { SideDrawer } from "../SideDrawer";
import { Button, EmptyState, Segmented, SelectField, StatusPill, Switch, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { createPrepTime, deletePrepTime, listPrepTimes, listZones, updatePrepTime, type DeliveryZone, type PrepTime, type PrepTimeInput } from "@/lib/api/admin-settings";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/stores/toast";

type Form = { name: string; mode: "days" | "date"; days: string; deliversFrom: string; activeFrom: string; activeUntil: string; appliesTo: "all" | "zones"; zoneIds: string[] };
type Errors = Partial<Record<"name" | "days" | "deliversFrom" | "activeUntil" | "zoneIds", string>>;

const emptyForm = (): Form => ({ name: "", mode: "days", days: "7", deliversFrom: "", activeFrom: "", activeUntil: "", appliesTo: "all", zoneIds: [] });
const toForm = (p: PrepTime): Form => ({ name: p.name, mode: p.mode, days: p.days ? String(p.days) : "7", deliversFrom: p.deliversFrom ?? "", activeFrom: p.activeFrom ?? "", activeUntil: p.activeUntil ?? "", appliesTo: p.appliesTo, zoneIds: p.zoneIds });

export function validatePrep(f: Form): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = "Give it a name";
  const days = Number(f.days);
  if (f.mode === "days" && !(Number.isInteger(days) && days >= 1 && days <= 365)) e.days = "Enter a whole number of days, from 1 to 365";
  if (f.mode === "date" && !f.deliversFrom) e.deliversFrom = "Choose the day deliveries start";
  if (f.activeFrom && f.activeUntil && f.activeUntil < f.activeFrom) e.activeUntil = "Must be on or after the start";
  if (f.appliesTo === "zones" && f.zoneIds.length === 0) e.zoneIds = "Choose at least one zone";
  return e;
}

export const toInput = (f: Form): PrepTimeInput => ({
  name: f.name.trim(),
  mode: f.mode,
  days: f.mode === "days" ? Number(f.days) : null,
  deliversFrom: f.mode === "date" ? f.deliversFrom : null,
  activeFrom: f.activeFrom || null,
  activeUntil: f.activeUntil || null,
  appliesTo: f.appliesTo,
  zoneIds: f.appliesTo === "zones" ? f.zoneIds : [],
});

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function summary(p: PrepTime): string {
  const when = p.mode === "days" ? `Deliveries start ${p.days} ${p.days === 1 ? "day" : "days"} from today` : `Deliveries start on ${p.deliversFrom ? shortDate(p.deliversFrom) : "—"}`;
  const window = p.activeFrom && p.activeUntil ? `, ${shortDate(p.activeFrom)} to ${shortDate(p.activeUntil)}` : p.activeFrom ? `, from ${shortDate(p.activeFrom)}` : p.activeUntil ? `, until ${shortDate(p.activeUntil)}` : "";
  return when + window;
}

/** Prep times: stretches when orders are prepared before delivery starts, for every zone or only some. */
export function PrepTimeSection({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const key = adminKeys.list("settings", { prepTimes: true });
  const preps = useQuery({ queryKey: key, queryFn: ({ signal }) => listPrepTimes({ signal }), staleTime: 0 });
  const zones = useQuery({ queryKey: adminKeys.list("settings", { zones: true }), queryFn: ({ signal }) => listZones({ signal }), staleTime: 0 });
  const [editing, setEditing] = useState<PrepTime | "new" | null>(null);
  const [removing, setRemoving] = useState<PrepTime | null>(null);
  const zoneName = (id: string) => zones.data?.find((z) => z.id === id)?.name ?? "A deleted zone";

  const toggle = useMutation({
    mutationFn: ({ prep, active }: { prep: PrepTime; active: boolean }) => updatePrepTime(prep.id, { active }),
    onSuccess: (next) => queryClient.setQueryData(key, next),
    onError: (err) => toast.error(adminErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (prep: PrepTime) => deletePrepTime(prep.id),
    onSuccess: (next, prep) => { queryClient.setQueryData(key, next); setRemoving(null); toast.success(`${prep.name} deleted`); },
    onError: (err) => { setRemoving(null); toast.error(adminErrorMessage(err)); },
  });

  return (
    <>
      <FormSection title="Prep time" description="Orders can need preparing before any delivery goes out. While a prep time applies, customers are told deliveries start after it, and then take each zone's usual days. If several apply to a zone, the longest wait is shown.">
        {canWrite ? <Button size="sm" variant="outline" className="self-start" iconLeft={<Plus aria-hidden="true" size={16} />} onClick={() => setEditing("new")}>Add prep time</Button> : null}
        {preps.isError ? <p role="alert" className="text-body-sm text-danger">{adminErrorMessage(preps.error)}</p> : null}
        {preps.data && preps.data.length === 0 ? <EmptyState title="No prep times">Add one when you need to hold deliveries back, such as a busy season.</EmptyState> : null}
        <ul aria-label="Prep times" className="flex flex-col gap-3">
          {(preps.data ?? []).map((p) => (
            <li key={p.id} className={cn("flex flex-col gap-3 rounded-card border p-4", p.active ? "border-line bg-surface" : "border-line-soft bg-surface-subtle")}>
              <div className="flex items-start justify-between gap-3">
                <span className={cn("flex min-w-0 flex-col gap-0.5 leading-[1.3]", !p.active && "opacity-60")}>
                  <span className="font-bold">{p.name}</span>
                  <span className="text-body-sm">{summary(p)}</span>
                  <span className="text-caption text-muted">{p.appliesTo === "all" ? "All zones" : p.zoneIds.map(zoneName).join(", ")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={p.active ? "success" : "neutral"}>{p.active ? "On" : "Off"}</StatusPill>
                  <Switch checked={p.active} label={`${p.name} is on`} disabled={!canWrite || toggle.isPending} onChange={(on) => toggle.mutate({ prep: p, active: on })} />
                </span>
              </div>
              {canWrite ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit<span className="sr-only"> {p.name}</span></Button>
                  <Button size="sm" variant="danger-soft" onClick={() => setRemoving(p)}>Delete<span className="sr-only"> {p.name}</span></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </FormSection>
      {editing ? <PrepDrawer prep={editing === "new" ? null : editing} zones={zones.data ?? []} onClose={() => setEditing(null)} onSaved={(next) => { queryClient.setQueryData(key, next); setEditing(null); toast.success("Prep time saved"); }} /> : null}
      <ConfirmDialog open={!!removing} title={`Delete ${removing?.name ?? "this prep time"}?`} confirmLabel="Delete" tone="danger" busy={remove.isPending} onCancel={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)}>
        <p>Customers will no longer be told deliveries are held back by it. Orders already placed keep the delivery start they were promised. To pause it instead, switch it off.</p>
      </ConfirmDialog>
    </>
  );
}

function PrepDrawer({ prep, zones, onClose, onSaved }: { prep: PrepTime | null; zones: DeliveryZone[]; onClose: () => void; onSaved: (preps: PrepTime[]) => void }) {
  const original = prep ? toForm(prep) : emptyForm();
  const [form, setForm] = useState<Form>(original);
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string>();
  const save = useMutation({ mutationFn: () => (prep ? updatePrepTime(prep.id, toInput(form)) : createPrepTime({ ...toInput(form), active: true })), onSuccess: onSaved, onError: (err) => setProblem(adminErrorMessage(err)) });
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const chosen = new Set(form.zoneIds);

  function submit() {
    const found = validatePrep(form);
    setErrors(found);
    setProblem(undefined);
    if (!Object.keys(found).length) save.mutate();
  }

  return (
    <SideDrawer open onClose={onClose} title={prep ? `Edit ${prep.name}` : "Add prep time"} dirty={dirty} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!dirty} onClick={submit}>Save prep time</Button></>}>
      <div className="flex flex-col gap-4">
        {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{problem}</p> : null}
        <TextField size="admin" label="Name" value={form.name} error={errors.name} onChange={(e) => set("name", e.target.value)} hint="For you, like December rush" />
        <SelectField size="admin" label="Deliveries start" value={form.mode} onChange={(e) => set("mode", e.target.value as Form["mode"])}>
          <option value="days">After a number of days from today</option>
          <option value="date">On a specific date</option>
        </SelectField>
        {form.mode === "days" ? (
          <TextField size="admin" label="Prep time (days)" inputMode="numeric" value={form.days} error={errors.days} onChange={(e) => set("days", e.target.value)} hint="Counted from the day the customer looks, so it keeps moving until the period ends." />
        ) : (
          <TextField size="admin" label="First delivery date" type="date" value={form.deliversFrom} error={errors.deliversFrom} onChange={(e) => set("deliversFrom", e.target.value)} />
        )}
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
          <legend className="px-1 text-label font-bold">When it applies</legend>
          <div className="grid grid-cols-2 gap-2.5">
            <TextField size="admin" label="From (optional)" type="date" value={form.activeFrom} onChange={(e) => set("activeFrom", e.target.value)} />
            <TextField size="admin" label="Until (optional)" type="date" value={form.activeUntil} error={errors.activeUntil} onChange={(e) => set("activeUntil", e.target.value)} />
          </div>
          <p className="text-caption text-muted">Leave blank to start now, or to keep going until you switch it off.</p>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <span className="text-label font-bold">Zones</span>
          <Segmented label="Zones" items={[{ value: "all", label: "All zones" }, { value: "zones", label: "Selected zones" }]} value={form.appliesTo} onChange={(v) => set("appliesTo", v)} />
        </div>
        {form.appliesTo === "zones" ? (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3.5">
            <legend className="px-1 text-label font-bold">Zones held back</legend>
            <div className="flex flex-col gap-1.5">
              {zones.map((z) => (
                <label key={z.id} className="flex items-center gap-2 text-body-sm">
                  <input type="checkbox" checked={chosen.has(z.id)} onChange={() => set("zoneIds", chosen.has(z.id) ? form.zoneIds.filter((i) => i !== z.id) : [...form.zoneIds, z.id])} className="size-[18px] accent-primary" />
                  {z.name}{z.active ? "" : " (off)"}
                </label>
              ))}
            </div>
            {errors.zoneIds ? <p role="alert" className="text-caption font-medium text-danger">{errors.zoneIds}</p> : null}
          </fieldset>
        ) : null}
      </div>
    </SideDrawer>
  );
}
