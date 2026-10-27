"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { FormSection } from "../FormSection";
import { SideDrawer } from "../SideDrawer";
import { Button, EmptyState, SelectField, Skeleton, Switch, TextareaField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { CUTOFFS, cutoffLabel, emptyZone, validateZone, zoneOptions, zoneToForm, zoneToInput, type ZoneErrors, type ZoneForm } from "@/lib/admin/settings";
import { listZones, saveZone, type DeliveryZone } from "@/lib/api/admin-settings";
import { cn } from "@/lib/cn";
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
                <p className="text-caption text-muted">{z.state}{z.areas.length ? ` · ${z.areas.join(", ")}` : " · whole state"}</p>
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
        <TextField size="admin" label="State" value={form.state} error={errors.state} onChange={(e) => set("state", e.target.value)} />
        <TextareaField size="admin" label="Areas" rows={4} value={form.areas} onChange={(e) => set("areas", e.target.value)} hint="One per line or separated by commas. Leave empty to cover the whole state." />
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
          <legend className="px-1 text-label font-bold">Delivery options and prices</legend>
          <TextField size="admin" label="Same-day" prefix="₦" inputMode="decimal" value={form.sameDayFee} error={errors.sameDayFee} onChange={(e) => set("sameDayFee", e.target.value)} hint="Leave blank to not offer it; 0 is free" />
          <SelectField size="admin" label="Same-day order cutoff" value={form.cutoff} onChange={(e) => set("cutoff", e.target.value)}>
            <option value="">No cutoff</option>
            {CUTOFFS.map((c) => <option key={c} value={c}>{cutoffLabel(c)}</option>)}
          </SelectField>
          <TextField size="admin" label="Next day" prefix="₦" inputMode="decimal" value={form.nextDayFee} error={errors.nextDayFee} onChange={(e) => set("nextDayFee", e.target.value)} />
          <TextField size="admin" label="Nationwide courier" prefix="₦" inputMode="decimal" value={form.nationwideFee} error={errors.nationwideFee} onChange={(e) => set("nationwideFee", e.target.value)} />
        </fieldset>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-surface-tint px-3.5 py-3">
          <span className="flex flex-col leading-[1.3]"><span className="font-bold">Pickup from the showroom</span><span className="text-caption text-muted">Free, for customers in this zone</span></span>
          <Switch checked={form.pickupEnabled} label="Offer pickup in this zone" onChange={(v) => set("pickupEnabled", v)} />
        </label>
      </div>
    </SideDrawer>
  );
}
