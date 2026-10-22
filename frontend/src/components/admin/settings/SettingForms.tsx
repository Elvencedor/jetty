"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { FormSection } from "../FormSection";
import { Button, SelectField, Skeleton, Switch, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { canSwitchOff, changedFields, holdChoices, PAYMENT_METHOD_ROWS, returnWindowChoices, returnWindowLabel, storeToForm, storeToSettings, validateStore, type StoreErrors } from "@/lib/admin/settings";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";
import { getSetting, patchSetting, type PaymentMethodKey, type SettingKey, type SettingsByKey } from "@/lib/api/admin-settings";
import { toast } from "@/lib/stores/toast";

/** Loads one setting and hands it, with a way to save a change to it, to the form. */
function Loaded<K extends SettingKey>({ name, saved, children }: { name: K; saved: string; children: (value: SettingsByKey[K], save: (patch: Partial<SettingsByKey[K]>) => Promise<SettingsByKey[K]>) => ReactNode }) {
  const queryClient = useQueryClient();
  const key = adminKeys.detail("settings", name);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => getSetting(name, { signal }), staleTime: 0 });
  if (query.isError && !query.data) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-5 text-danger">
        <span>{adminErrorMessage(query.error)}</span>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  }
  if (!query.data) return <Skeleton className="h-72 rounded-card" />;
  async function save(patch: Partial<SettingsByKey[K]>) {
    const next = await patchSetting(name, patch);
    queryClient.setQueryData(key, next);
    toast.success(saved);
    return next;
  }
  // Keyed by the stored value, so the form starts again from what was saved.
  return <div key={JSON.stringify(query.data)}>{children(query.data, save)}</div>;
}

/** Discard and Save changes, with the reason a save failed beside them. Save waits for a change. */
function Footer({ dirty, saving, error, onDiscard, onSave }: { dirty: boolean; saving: boolean; error: string | undefined; onDiscard: () => void; onSave: () => void }) {
  useUnsavedGuard(dirty);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? <p role="alert" className="mr-auto text-body-sm font-medium text-danger">{error}</p> : null}
      <Button variant="outline" disabled={!dirty || saving} onClick={onDiscard}>Discard</Button>
      <Button variant="primary" loading={saving} disabled={!dirty} onClick={onSave}>Save changes</Button>
    </div>
  );
}

/** Runs a save, keeping what went wrong for the footer. */
function useSaver() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, run, setError };
}

// ------------------------------------------------------------------- store

export function StoreFormCard({ canWrite }: { canWrite: boolean }) {
  return <Loaded name="store" saved="Store details saved">{(value, save) => <StoreForm initial={value} canWrite={canWrite} save={save} />}</Loaded>;
}

function StoreForm({ initial, canWrite, save }: { initial: SettingsByKey["store"]; canWrite: boolean; save: (patch: Partial<SettingsByKey["store"]>) => Promise<unknown> }) {
  const original = storeToForm(initial);
  const [form, setForm] = useState(original);
  const [errors, setErrors] = useState<StoreErrors>({});
  const { saving, error, run, setError } = useSaver();
  const patch = changedFields(initial, storeToSettings(form));
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [key]: e.target.value })); setErrors((x) => ({ ...x, [key]: undefined })); };

  function submit() {
    const found = validateStore(form);
    setErrors(found);
    if (Object.keys(found).length || !patch) return;
    void run(() => save(patch));
  }

  return (
    <>
      <FormSection title="Store details" className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))]">
        <TextField size="admin" label="Store name" value={form.name} error={errors.name} disabled={!canWrite} onChange={set("name")} />
        <TextField size="admin" label="Support email" type="email" value={form.contactEmail} error={errors.contactEmail} disabled={!canWrite} onChange={set("contactEmail")} />
        <TextField size="admin" label="Support phone" type="tel" value={form.contactPhone} error={errors.contactPhone} disabled={!canWrite} onChange={set("contactPhone")} />
        <TextField size="admin" label="WhatsApp business number" type="tel" value={form.whatsappNumber} error={errors.whatsappNumber} disabled={!canWrite} onChange={set("whatsappNumber")} />
        <TextField size="admin" label="Support hours" value={form.showroomHours} disabled={!canWrite} onChange={set("showroomHours")} hint="For example Mon–Sat, 9am–7pm" />
        <TextField size="admin" label="Showroom / pickup address" value={form.showroomAddress} disabled={!canWrite} onChange={set("showroomAddress")} className="sm:col-span-2" />
        <p className="col-span-full text-body-sm text-muted">Logo, colours and fonts live in <Link href="/admin/storefront" className="font-semibold text-primary-strong underline">Storefront › Theme &amp; logo</Link>.</p>
      </FormSection>
      {canWrite ? <Footer dirty={dirty} saving={saving} error={error} onDiscard={() => { setForm(original); setErrors({}); setError(undefined); }} onSave={submit} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- payments

export function PaymentsForm({ canWrite }: { canWrite: boolean }) {
  return <Loaded name="payments" saved="Payment settings saved">{(value, save) => <PaymentsEditor initial={value} canWrite={canWrite} save={save} />}</Loaded>;
}

function PaymentsEditor({ initial, canWrite, save }: { initial: SettingsByKey["payments"]; canWrite: boolean; save: (patch: Partial<SettingsByKey["payments"]>) => Promise<unknown> }) {
  const [form, setForm] = useState(initial);
  const { saving, error, run, setError } = useSaver();
  const patch = changedFields(initial, form);
  const toggle = (key: PaymentMethodKey, on: boolean) => setForm((f) => ({ ...f, enabledMethods: on ? [...f.enabledMethods, key] : f.enabledMethods.filter((m) => m !== key) }));

  return (
    <>
      <FormSection title="Payments">
        <div className="flex items-center gap-3 rounded-[18px] bg-surface-tint p-3.5">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-surface font-extrabold text-primary-strong">PS</span>
          <span className="flex flex-col leading-[1.3]"><span className="font-bold">Paystack</span><span className="text-body-sm text-muted">Card and bank transfer payments are processed by Paystack. Keys and the payout account are managed in your Paystack dashboard.</span></span>
        </div>
        <ul>
          {PAYMENT_METHOD_ROWS.map((m) => {
            const on = form.enabledMethods.includes(m.key);
            const last = !canSwitchOff(form.enabledMethods, m.key);
            return (
              <li key={m.key} className="flex min-h-14 items-center justify-between gap-3 border-b border-line-soft last:border-0">
                <span className="flex flex-col leading-[1.3]"><span className="font-bold">{m.label}</span><span className="text-caption text-muted">{last ? "At least one method must stay on" : m.note}</span></span>
                <Switch checked={on} label={`Accept ${m.label.toLowerCase()} payments`} disabled={!canWrite || last} onChange={(v) => toggle(m.key, v)} />
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3.5">
          <SelectField size="admin" label="Hold stock for card payments" value={form.cardHoldMinutes} disabled={!canWrite} onChange={(e) => setForm((f) => ({ ...f, cardHoldMinutes: Number(e.target.value) }))} hint="After this, an unpaid card order is released.">
            {holdChoices(form.cardHoldMinutes).map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
          </SelectField>
          <SelectField size="admin" label="Cancel unpaid transfer orders after" value={form.transferHoldMinutes} disabled={!canWrite} onChange={(e) => setForm((f) => ({ ...f, transferHoldMinutes: Number(e.target.value) }))} hint="Stock is held for this long while a customer pays by transfer.">
            {holdChoices(form.transferHoldMinutes).map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
          </SelectField>
        </div>
      </FormSection>
      {canWrite ? <Footer dirty={!!patch} saving={saving} error={error} onDiscard={() => { setForm(initial); setError(undefined); }} onSave={() => patch && void run(() => save(patch))} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- policies

export function PoliciesForm({ canWrite }: { canWrite: boolean }) {
  return <Loaded name="policies" saved="Policies saved">{(value, save) => <PoliciesEditor initial={value} canWrite={canWrite} save={save} />}</Loaded>;
}

function PoliciesEditor({ initial, canWrite, save }: { initial: SettingsByKey["policies"]; canWrite: boolean; save: (patch: Partial<SettingsByKey["policies"]>) => Promise<unknown> }) {
  const [days, setDays] = useState(initial.returnWindowDays);
  const { saving, error, run, setError } = useSaver();
  const dirty = days !== initial.returnWindowDays;
  return (
    <>
      <FormSection title="Returns & policies">
        <div className="max-w-sm">
          <SelectField size="admin" label="Return window" value={days} disabled={!canWrite} onChange={(e) => setDays(Number(e.target.value))} hint="Shown to customers on product pages and in your return policy.">
            {returnWindowChoices(days).map((d) => <option key={d} value={d}>{returnWindowLabel(d)}</option>)}
          </SelectField>
        </div>
        <p className="text-body-sm text-muted">The wording of the Returns, Delivery, Terms and Privacy pages is edited in <Link href="/admin/storefront" className="font-semibold text-primary-strong underline">Storefront › Pages</Link>.</p>
      </FormSection>
      {canWrite ? <Footer dirty={dirty} saving={saving} error={error} onDiscard={() => { setDays(initial.returnWindowDays); setError(undefined); }} onSave={() => void run(() => save({ returnWindowDays: days }))} /> : null}
    </>
  );
}
