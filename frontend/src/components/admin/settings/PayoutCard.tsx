"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SideDrawer } from "../SideDrawer";
import { Button, SelectField, Skeleton, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { accountDigits, isAccountNumber, maskedAccount, validatePayout, type PayoutForm } from "@/lib/admin/payouts";
import { getPayoutAccount, listBanks, resolveAccount, savePayoutAccount, type PayoutAccount } from "@/lib/api/admin-payouts";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/stores/toast";

/** Where sales are paid out: the connected Paystack payout account, or a prompt to connect one. */
export function PayoutCard({ canWrite, storeName }: { canWrite: boolean; storeName: string }) {
  const key = adminKeys.detail("settings", "payout-account");
  const account = useQuery({ queryKey: key, queryFn: ({ signal }) => getPayoutAccount({ signal }), staleTime: 0 });
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const data = account.data;

  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-surface-tint p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-surface font-extrabold text-primary-strong">PS</span>
        <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
          <span className="font-bold">Paystack payout account</span>
          {account.isError && !data ? (
            <span role="alert" className="text-body-sm text-danger">{adminErrorMessage(account.error)}</span>
          ) : !data ? (
            <Skeleton className="mt-1 h-4 w-48" />
          ) : data.configured ? (
            <span className="text-body-sm text-muted">
              <span className={cn("font-semibold", data.mode === "live" ? "text-success" : "text-warning")}>{data.mode === "live" ? "Connected · live mode" : "Connected · test mode"}</span>
              {" · "}{maskedAccount(data.bankName, data.accountLast4)} · {data.accountName}
            </span>
          ) : (
            <span className="text-body-sm text-muted">No payout account yet. Until you connect one, sales are paid to the main Paystack account.</span>
          )}
        </span>
        {account.isError && !data ? <Button size="sm" variant="outline" onClick={() => void account.refetch()}>Retry</Button> : null}
        {data && canWrite ? <Button size="sm" variant={data.configured ? "outline" : "primary"} onClick={() => setEditing(true)}>{data.configured ? "Change account" : "Connect payout account"}</Button> : null}
      </div>
      {editing && data ? (
        <PayoutDrawer
          current={data}
          storeName={storeName}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            queryClient.setQueryData(key, next);
            setEditing(false);
            toast.success("Payout account connected");
          }}
        />
      ) : null}
    </div>
  );
}

function PayoutDrawer({ current, storeName, onClose, onSaved }: { current: PayoutAccount; storeName: string; onClose: () => void; onSaved: (a: PayoutAccount) => void }) {
  const [form, setForm] = useState<PayoutForm>({ businessName: current.configured ? current.businessName : storeName, bankCode: "", accountNumber: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof PayoutForm, string>>>({});
  const banks = useQuery({ queryKey: ["admin", "banks"], queryFn: ({ signal }) => listBanks({ signal }), staleTime: 60 * 60_000 });

  // Once a bank and ten digits are in, ask Paystack whose account it is, so the owner can see the name before saving.
  const ready = !!form.bankCode && isAccountNumber(form.accountNumber);
  const lookup = useQuery({
    queryKey: ["admin", "resolve", form.bankCode, form.accountNumber],
    queryFn: ({ signal }) => resolveAccount({ bankCode: form.bankCode, accountNumber: form.accountNumber }, { signal }),
    enabled: ready,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const save = useMutation({ mutationFn: () => savePayoutAccount({ ...form, businessName: form.businessName.trim() }), onSuccess: onSaved });
  const set = <K extends keyof PayoutForm>(k: K, v: PayoutForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); save.reset(); };
  const dirty = !!form.bankCode || !!form.accountNumber || form.businessName !== (current.configured ? current.businessName : storeName);

  function submit() {
    const found = validatePayout(form);
    setErrors(found);
    if (!Object.keys(found).length && lookup.data) save.mutate();
  }

  return (
    <SideDrawer
      open
      onClose={onClose}
      title={current.configured ? "Change payout account" : "Connect payout account"}
      dirty={dirty}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!lookup.data} onClick={submit}>{current.configured ? "Save account" : "Connect account"}</Button></>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-muted">Sales are paid into this bank account by Paystack. We only keep the last four digits; Paystack holds the full number.</p>
        {current.configured ? <p className="rounded-lg bg-surface-tint px-3 py-2 text-body-sm">Now: <strong>{maskedAccount(current.bankName, current.accountLast4)}</strong>, {current.accountName}</p> : null}
        {save.isError ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm text-danger">{adminErrorMessage(save.error)}</p> : null}
        <TextField size="admin" label="Business name" value={form.businessName} error={errors.businessName} onChange={(e) => set("businessName", e.target.value)} hint="Shown on your Paystack account" />
        {banks.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger"><span>{adminErrorMessage(banks.error)}</span><Button size="sm" variant="outline" onClick={() => void banks.refetch()}>Retry</Button></div>
        ) : (
          <SelectField size="admin" label="Bank" value={form.bankCode} error={errors.bankCode} disabled={!banks.data} onChange={(e) => set("bankCode", e.target.value)}>
            <option value="">{banks.data ? "Choose a bank" : "Loading banks…"}</option>
            {banks.data?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </SelectField>
        )}
        <TextField size="admin" label="Account number" inputMode="numeric" autoComplete="off" value={form.accountNumber} error={errors.accountNumber} onChange={(e) => set("accountNumber", accountDigits(e.target.value))} hint="10 digits" />
        <div aria-live="polite" className="min-h-6 text-body-sm">
          {ready && lookup.isFetching ? <span className="text-muted">Checking with Paystack…</span> : null}
          {ready && lookup.data ? <span className="font-semibold text-success">✓ {lookup.data.accountName}</span> : null}
          {ready && lookup.isError ? <span role="alert" className="font-medium text-danger">{adminErrorMessage(lookup.error)}</span> : null}
        </div>
        <p className="text-caption text-muted">Check that the name above is the business&apos;s. Money can&apos;t be moved until the account is confirmed.</p>
      </div>
    </SideDrawer>
  );
}
