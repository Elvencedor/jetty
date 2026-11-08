"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { FormSection } from "../FormSection";
import { SideDrawer } from "../SideDrawer";
import { Button, EmptyState, Segmented, SelectField, Skeleton, Switch, TextareaField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { onAmountChange } from "@/lib/admin/amount";
import { adminKeys } from "@/lib/admin/keys";
import { emptyZone, validateZone, zoneCoverage, zoneOptions, zoneToForm, zoneToInput, type ZoneErrors, type ZoneForm } from "@/lib/admin/settings";
import { listZones, saveZone, type DeliveryZone } from "@/lib/api/admin-settings";
import { cn } from "@/lib/cn";
import { NIGERIAN_STATES } from "@/lib/geo/states";
import { formatNaira } from "@/lib/format";
import { toast } from "@/lib/stores/toast";

/** Delivery zones as cards: what each offers and what checkout charges for it. Editing happens in a drawer. */
export function DeliverySection({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const key = adminKeys.list("settings", { zones: true });
  const zones = useQuery({ queryKey: key, queryFn: ({ signal }) => listZones({ signal }), staleTime: 0 });
  const [editing, setEditing] = useState<DeliveryZone | "new" | null>(null);
  const [switchOff, setSwitchOff] = useState<DeliveryZone | null>(null);

  const toggle = useMutation({
    mutationFn: ({ zone, active }: { zone: DeliveryZone; active: boolean }) => saveZone({ id: zone.id, active }),
    onSuccess: (next, { zone, active }) => {
      queryClient.setQueryData(key, next);
      setSwitchOff(null);
      toast.success(active ? `Delivering to ${zone.name} again` : `${zone.name} switched off`);
    },
    onError: (err) => {
      setSwitchOff(null);
      toast.error(adminErrorMessage(err));
    },
  });

  return (
    <>
      <FormSection title="Delivery zones" description="Customers only see options that apply to their address. Prices here are what checkout charges.">
        {canWrite ? <Button size="sm" variant="outline" className="self-start" iconLeft={<Plus aria-hidden="true" size={16} />} onClick={() => setEditing("new")}>Add zone</Button> : null}
        {zones.isError && !zones.data ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger">
            <span>{adminErrorMessage(zones.error)}</span>
            <Button size="sm" variant="outline" onClick={() => void zones.refetch()}>Retry</Button>
          </div>
        ) : !zones.data ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-[20px]" />)}</div>
        ) : zones.data.length === 0 ? (
          <EmptyState title="No delivery zones yet">Add a zone so customers can have orders delivered.</EmptyState>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            {zones.data.map((z) => (
              <li key={z.id} className={cn("flex flex-col gap-2.5 rounded-[20px] border-2 p-4", z.active ? "border-primary bg-surface-tint" : "border-line bg-surface")}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-body-lg font-extrabold">{z.name}</h3>
                  <Switch checked={z.active} label={`Deliver to ${z.name}`} disabled={!canWrite || toggle.isPending} onChange={(on) => (on ? toggle.mutate({ zone: z, active: true }) : setSwitchOff(z))} />
                </div>
                <p className="text-caption text-muted">{zoneCoverage(z)}</p>
                <ul className="flex flex-col gap-1.5">
                  {zoneOptions(z, formatNaira).map((o) => (
                    <li key={o.name} className="flex items-center justify-between gap-2 rounded-[12px] border border-line bg-surface px-2.5 py-2 text-body-sm">
                      <span className="flex flex-col leading-[1.3]"><span className="font-bold">{o.name}</span><span className="text-caption text-muted">{o.note}</span></span>
                      <span className="font-bold">{o.price}</span>
                    </li>
                  ))}
                  {zoneOptions(z, formatNaira).length === 0 ? <li className="text-caption text-muted">No delivery options are priced for this zone.</li> : null}
                </ul>
                {canWrite ? <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing(z)}>Edit<span className="sr-only"> {z.name}</span></Button> : null}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      {editing ? <ZoneDrawer zone={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(next) => { queryClient.setQueryData(key, next); setEditing(null); toast.success("Delivery settings saved"); }} /> : null}
      <ConfirmDialog open={!!switchOff} title={`Switch off ${switchOff?.name ?? "this zone"}?`} confirmLabel="Switch off" tone="danger" busy={toggle.isPending} onCancel={() => setSwitchOff(null)} onConfirm={() => switchOff && toggle.mutate({ zone: switchOff, active: false })}>
        Customers there will no longer be able to check out with delivery. Orders already placed are still delivered.
      </ConfirmDialog>
    </>
  );
}

function ZoneDrawer({ zone, onClose, onSaved }: { zone: DeliveryZone | null; onClose: () => void; onSaved: (zones: DeliveryZone[]) => void }) {
  const original = zone ? zoneToForm(zone) : emptyZone();
  const [form, setForm] = useState<ZoneForm>(original);
  const [errors, setErrors] = useState<ZoneErrors>({});
  const [problem, setProblem] = useState<string>();
  const save = useMutation({ mutationFn: () => saveZone(zoneToInput(form, zone?.id)), onSuccess: onSaved, onError: (err) => setProblem(adminErrorMessage(err)) });
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = <K extends keyof ZoneForm>(key: K, value: ZoneForm[K]) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined })); };

  function submit() {
    const found = validateZone(form);
    setErrors(found);
    setProblem(undefined);
    if (!Object.keys(found).length) save.mutate();
  }

  return (
    <SideDrawer
      open
      onClose={onClose}
      title={zone ? `Edit ${zone.name}` : "Add delivery zone"}
      dirty={dirty}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!dirty} onClick={submit}>Save zone</Button></>}
    >
      <div className="flex flex-col gap-4">
        {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{problem}</p> : null}
        <TextField size="admin" label="Zone name" value={form.name} error={errors.name} onChange={(e) => set("name", e.target.value)} hint="Customers see this, like Lagos Mainland" />
        <div className="flex flex-col gap-1.5">
          <span className="text-label font-bold">Coverage</span>
          <Segmented label="Coverage" items={[{ value: "state", label: "One state" }, { value: "nationwide", label: "Nationwide" }]} value={form.scope} onChange={(v) => set("scope", v)} />
          <p className="text-caption text-muted">{form.scope === "state" ? "Delivers to one state, or only to the areas you list in it." : "One price for every state you pick. A state with its own zone is priced by that zone instead."}</p>
        </div>
        {form.scope === "state" ? (
          <>
            <SelectField size="admin" label="State" value={form.state} error={errors.state} onChange={(e) => set("state", e.target.value)}>
              <option value="">Choose a state</option>
              {/* A state saved before this list existed stays selectable rather than silently vanishing. */}
              {form.state && !(NIGERIAN_STATES as readonly string[]).includes(form.state) ? <option value={form.state}>{form.state}</option> : null}
              {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </SelectField>
            <TextareaField size="admin" label="Areas" rows={4} value={form.areas} onChange={(e) => set("areas", e.target.value)} hint="One per line or separated by commas. Leave empty to cover the whole state." />
          </>
        ) : (
          <StatePicker selected={form.states} error={errors.states} onChange={(states) => set("states", states)} />
        )}
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
          <legend className="px-1 text-label font-bold">Delivery price and time</legend>
          <TextField size="admin" label="Delivery price" prefix="₦" inputMode="decimal" value={form.deliveryFee} error={errors.deliveryFee} onChange={onAmountChange(form.deliveryFee, (v) => set("deliveryFee", v))} hint="What checkout charges for delivery here. 0 is free; leave blank to offer pickup only" />
          <div className="grid grid-cols-2 gap-2.5">
            <TextField size="admin" label="Fastest (days)" inputMode="numeric" value={form.minDays} error={errors.minDays} onChange={(e) => set("minDays", e.target.value)} />
            <TextField size="admin" label="Slowest (days)" inputMode="numeric" value={form.maxDays} error={errors.maxDays} onChange={(e) => set("maxDays", e.target.value)} />
          </div>
          <p className="text-caption text-muted">Counted from the day the order is placed, and shown to customers at checkout as dates. 0 means the same day.</p>
        </fieldset>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-surface-tint px-3.5 py-3">
          <span className="flex flex-col leading-[1.3]"><span className="font-bold">Pickup from the showroom</span><span className="text-caption text-muted">Free, for customers in this zone</span></span>
          <Switch checked={form.pickupEnabled} label="Offer pickup in this zone" onChange={(v) => set("pickupEnabled", v)} />
        </label>
      </div>
    </SideDrawer>
  );
}

/** The states a nationwide zone covers, as a checklist with select-all. */
function StatePicker({ selected, error, onChange }: { selected: string[]; error?: string | undefined; onChange: (states: string[]) => void }) {
  const chosen = new Set(selected);
  const all = chosen.size === NIGERIAN_STATES.length;
  const toggle = (state: string) => onChange(NIGERIAN_STATES.filter((s) => (s === state ? !chosen.has(s) : chosen.has(s))));
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3.5" aria-describedby={error ? "zone-states-error" : undefined}>
      <legend className="px-1 text-label font-bold">States in this zone</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted">{chosen.size} of {NIGERIAN_STATES.length} selected</span>
        <Button size="sm" variant="outline" onClick={() => onChange(all ? [] : [...NIGERIAN_STATES])}>{all ? "Clear all" : "Select all"}</Button>
      </div>
      <div className="grid max-h-64 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto">
        {NIGERIAN_STATES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-body-sm">
            <input type="checkbox" checked={chosen.has(s)} onChange={() => toggle(s)} className="size-[18px] accent-primary" />
            {s}
          </label>
        ))}
      </div>
      {error ? <p id="zone-states-error" role="alert" className="text-caption font-medium text-danger">{error}</p> : null}
    </fieldset>
  );
}
