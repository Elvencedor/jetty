"use client";

import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { SelectField, TextareaField, TextField } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { parseNairaToMinor, refundable } from "@/lib/admin/orders";
import { cancelAdminOrder, confirmTransfer, refundAdminOrder, type AdminOrderDetail } from "@/lib/api/admin-orders";
import { isApiError } from "@/lib/api/client";
import { formatNaira } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/checkout/request";

type DialogProps = { open: boolean; detail: AdminOrderDetail; onCancel: () => void; onDone: (message: string) => void };

/** Runs a submit, keeping the dialog open with the reason it failed. */
function useSubmit(onDone: (message: string) => void, explain?: (err: unknown) => string | undefined) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await action());
    } catch (err) {
      setError(explain?.(err) ?? adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

const Problem = ({ children }: { children?: string }) => (children ? <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-body-sm font-medium text-danger">{children}</p> : null);

/** Bank transfer: asks the payment provider first; when it has nothing, a written reason (the evidence) confirms it by hand. */
export function ConfirmTransferDialog({ open, detail, onCancel, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const { busy, error, setError, run } = useSubmit(onDone, (err) =>
    // The provider has not seen the money: say so, and point at the field that can settle it.
    isApiError(err) && err.code === "TRANSFER_NOT_CONFIRMED" ? "The bank hasn't reported this transfer yet. If you've seen the money arrive, write down where (the statement line or bank reference) and confirm again." : undefined,
  );
  const reference = detail.payments.find((p) => p.method === "bank_transfer")?.reference;

  function submit() {
    const evidence = reason.trim();
    if (evidence && evidence.length < 10) return setFieldError("Add a little more detail, at least 10 characters");
    setFieldError(undefined);
    void run(async () => {
      const res = await confirmTransfer(detail.order.id, evidence || undefined);
      return res.mode === "manual" ? "Transfer confirmed by hand" : res.mode === "provider" ? "Transfer confirmed" : "This transfer was already confirmed";
    });
  }

  return (
    <ConfirmDialog open={open} title="Confirm transfer received" confirmLabel="Confirm transfer" busy={busy} initialFocus="content" onCancel={() => { setError(undefined); setFieldError(undefined); onCancel(); }} onConfirm={submit}>
      <div className="flex flex-col gap-3">
        <p>We&apos;ll check with the payment provider first{reference ? <> (reference <span className="font-semibold text-ink">{reference}</span>)</> : null}. The order then moves to &ldquo;Paid · to pack&rdquo; and the customer is told.</p>
        <TextareaField size="admin" label="Evidence (only if the bank hasn't reported it)" rows={3} autoFocus value={reason} error={fieldError} onChange={(e) => { setReason(e.target.value); setFieldError(undefined); }} hint="For example: GTBank statement shows ₦2,000 credit, ref 4471. It is saved in the audit log." />
        <Problem>{error}</Problem>
      </div>
    </ConfirmDialog>
  );
}

/** Full or partial refund of a successful payment. One idempotency key per dialog opening, so a retry never refunds twice. */
export function RefundDialog({ open, detail, onCancel, onDone }: DialogProps) {
  const { remainingMinor, attempts } = refundable(detail);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; attempt?: string }>({});
  const [key, setKey] = useState(newIdempotencyKey);
  const { busy, error, setError, run } = useSubmit(onDone);
  const several = attempts.length > 1;
  const chosen = attempts.find((a) => a.id === attemptId) ?? (several ? undefined : attempts[0]);
  const ceiling = chosen?.remainingMinor ?? remainingMinor;

  function submit() {
    const next: typeof errors = {};
    let amountMinor: number | undefined;
    if (several && !chosen) next.attempt = "Choose which payment to refund";
    if (mode === "partial") {
      const parsed = parseNairaToMinor(amount);
      if (parsed === null || parsed < 1) next.amount = "Enter an amount, like 5,000";
      else if (parsed > ceiling) next.amount = `That's more than the ${formatNaira(ceiling)} left to refund`;
      else amountMinor = parsed;
    }
    if (reason.trim().length < 5) next.reason = "Give a reason, at least 5 characters";
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(async () => {
      await refundAdminOrder(detail.order.id, { reason: reason.trim(), ...(amountMinor ? { amountMinor } : {}), ...(several && chosen ? { paymentAttemptId: chosen.id } : {}) }, key);
      setKey(newIdempotencyKey());
      return `Refund of ${formatNaira(amountMinor ?? ceiling)} sent to the payment provider`;
    });
  }

  return (
    <ConfirmDialog open={open} title="Refund order" confirmLabel={mode === "full" ? `Refund ${formatNaira(ceiling)}` : "Refund"} tone="danger" busy={busy} initialFocus="content" onCancel={() => { setError(undefined); setErrors({}); onCancel(); }} onConfirm={submit}>
      {ceiling <= 0 ? (
        <p>There is nothing left to refund on this order.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p>The money goes back to the customer&apos;s original payment method. Stock is not returned automatically.</p>
          {several ? (
            <SelectField size="admin" label="Payment to refund" value={attemptId} error={errors.attempt} onChange={(e) => setAttemptId(e.target.value)}>
              <option value="">Choose a payment</option>
              {attempts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </SelectField>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-label font-semibold text-ink">Amount</legend>
            <label className="flex items-center gap-2"><input type="radio" name="refund-mode" checked={mode === "full"} onChange={() => setMode("full")} className="size-[18px] accent-primary" />Everything left ({formatNaira(ceiling)})</label>
            <label className="flex items-center gap-2"><input type="radio" name="refund-mode" checked={mode === "partial"} onChange={() => setMode("partial")} className="size-[18px] accent-primary" />Part of it</label>
          </fieldset>
          {mode === "partial" ? <TextField size="admin" label="Amount to refund" prefix="₦" inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} /> : null}
          <TextareaField size="admin" label="Reason" rows={2} value={reason} error={errors.reason} onChange={(e) => setReason(e.target.value)} />
          <Problem>{error}</Problem>
        </div>
      )}
    </ConfirmDialog>
  );
}

/** Cancels an order that hasn't gone out. A paid order is restocked unless unticked, and still needs refunding separately. */
export function CancelDialog({ open, detail, onCancel, onDone }: DialogProps) {
  const paid = detail.order.paymentStatus === "paid";
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [fieldError, setFieldError] = useState<string>();
  const { busy, error, setError, run } = useSubmit(onDone);

  function submit() {
    if (reason.trim().length < 5) return setFieldError("Give a reason, at least 5 characters");
    setFieldError(undefined);
    void run(async () => {
      await cancelAdminOrder(detail.order.id, { reason: reason.trim(), ...(paid ? { restock } : {}) });
      return paid ? "Order cancelled. Refund it next if the customer should get their money back" : "Order cancelled and its stock released";
    });
  }

  return (
    <ConfirmDialog open={open} title="Cancel this order?" confirmLabel="Cancel order" cancelLabel="Keep order" tone="danger" busy={busy} initialFocus="content" onCancel={() => { setError(undefined); setFieldError(undefined); onCancel(); }} onConfirm={submit}>
      <div className="flex flex-col gap-3">
        <p>{paid ? "The customer has paid. Cancelling does not refund them; use Refund afterwards." : "The stock held for this order goes back on sale."}</p>
        <TextareaField size="admin" label="Reason" rows={2} autoFocus value={reason} error={fieldError} onChange={(e) => { setReason(e.target.value); setFieldError(undefined); }} />
        {paid ? <label className="flex items-center gap-2"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="size-[18px] accent-primary" />Put the items back in stock</label> : null}
        <Problem>{error}</Problem>
      </div>
    </ConfirmDialog>
  );
}
