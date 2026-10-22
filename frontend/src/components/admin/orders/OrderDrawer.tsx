"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SideDrawer } from "../SideDrawer";
import { Button, Media, Skeleton, StatusPill } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { adminKeys } from "@/lib/admin/keys";
import { activity, addressLines, customerLine, METHOD_LABEL, nextStep, PROGRESS_STEPS, progressDone, riderPhoneToE164, totalsRows, whatsappLink, refundable } from "@/lib/admin/orders";
import { permits } from "@/lib/admin/permissions";
import { addOrderNote, advanceAdminOrder, getAdminOrder, updateOrderDelivery, type AdminOrderDetail } from "@/lib/api/admin-orders";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNaira, formatNairaK, formatPhone } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { useAdminSession } from "@/lib/stores/session";
import { toast } from "@/lib/stores/toast";
import { CancelDialog, ConfirmTransferDialog, RefundDialog } from "./OrderDialogs";
import { PackingSlip } from "./PackingSlip";

const CLOSED = ["delivered", "cancelled", "refunded"];
const SECTION = "flex flex-col gap-2.5 border-b border-line-soft px-[18px] py-4";
const CARD = "flex flex-col gap-1 rounded-lg bg-surface-tint p-3 text-body-sm";
const CARD_TITLE = "text-micro font-extrabold tracking-[0.6px] text-primary-strong";

/** Loads an order and shows it in the drawer. */
export function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: adminKeys.detail("orders", orderId), queryFn: ({ signal }) => getAdminOrder(orderId, { signal }), staleTime: 0 });
  if (!detail.data) {
    return (
      <SideDrawer open onClose={onClose} title="Order details" compactTitle>
        {detail.isError ? (
          <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-danger">
            <span>{adminErrorMessage(detail.error)}</span>
            <Button size="sm" variant="outline" onClick={() => detail.refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-[50px] rounded-pill" /><Skeleton className="h-40" /></div>
        )}
      </SideDrawer>
    );
  }
  return <OrderView detail={detail.data} onClose={onClose} />;
}

type Dialog = "transfer" | "refund" | "cancel" | null;

function OrderView({ detail, onClose }: { detail: AdminOrderDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canFulfil = permits(held, "orders:fulfil") || permits(held, "orders:write");
  const canConfirm = permits(held, "orders:write");
  const canRefund = permits(held, "orders:refund");
  const canCancel = permits(held, "orders:cancel");
  const canSeeCustomer = permits(held, "customers:read");

  const { order, customer, delivery } = detail;
  const pill = ORDER_STATUS[order.status];
  const step = nextStep(detail);
  const closed = CLOSED.includes(order.status);
  const done = progressDone(order.status);
  const method = detail.payments.find((p) => p.status === "succeeded")?.method ?? detail.payments[0]?.method;
  const a = order.deliveryAddressSnapshot;
  const hasRider = !!delivery?.riderName;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rider, setRider] = useState({ name: delivery?.riderName ?? "", phone: delivery?.riderPhoneE164 ?? "" });
  const [riderError, setRiderError] = useState<string>();
  const riderDirty = rider.name.trim() !== (delivery?.riderName ?? "") || rider.phone.trim() !== (delivery?.riderPhoneE164 ?? "");
  const dirty = !!note.trim() || (canFulfil && riderDirty);

  const key = adminKeys.detail("orders", order.id);
  /** Whatever changed an order may have changed lists, counts and the nav badge. */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.resource("orders") });
    void queryClient.invalidateQueries({ queryKey: adminKeys.badges });
  };
  const reload = () => queryClient.invalidateQueries({ queryKey: key });

  const advance = useMutation({
    mutationFn: (to: "packed" | "out_for_delivery" | "delivered") => advanceAdminOrder(order.id, to),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      setProblem(null);
      toast.success(`${ORDER_STATUS[fresh.order.status].label}. The customer has been told.`);
      refresh();
    },
    onError: (err) => {
      setProblem(adminErrorMessage(err));
      void reload();
    },
  });

  const addNote = useMutation({
    mutationFn: (text: string) => addOrderNote(order.id, text),
    onSuccess: () => {
      setNote("");
      toast.success("Note added");
      void reload();
    },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  const saveRider = useMutation({
    mutationFn: (body: { riderName: string | null; riderPhoneE164: string | null }) => updateOrderDelivery(order.id, body),
    onSuccess: () => {
      toast.success("Rider saved");
      void reload();
    },
    onError: (err) => toast.error(adminErrorMessage(err)),
  });

  function submitNote(e: FormEvent) {
    e.preventDefault();
    if (note.trim()) addNote.mutate(note.trim());
  }

  function submitRider(e: FormEvent) {
    e.preventDefault();
    const phone = rider.phone.trim() ? riderPhoneToE164(rider.phone) : null;
    if (rider.phone.trim() && !phone) return setRiderError("Enter a phone number like 0803 123 4567");
    setRiderError(undefined);
    saveRider.mutate({ riderName: rider.name.trim() || null, riderPhoneE164: phone });
  }

  function finished(message: string) {
    setDialog(null);
    toast.success(message);
    void reload();
    refresh();
  }

  const log = activity(detail);
  const totals = totalsRows(order);
  const canRefundNow = canRefund && order.paymentStatus === "paid" && refundable(detail).remainingMinor > 0;
  const canCancelNow = canCancel && ["pending_payment", "placed", "packed"].includes(order.status);
  const blocked = step?.kind === "advance" && step.needsRider && !hasRider;

  function onNext() {
    if (!step) return;
    setProblem(null);
    if (step.kind === "confirm") setDialog("transfer");
    else advance.mutate(step.to);
  }

  return (
    <SideDrawer open onClose={onClose} title="Order details" compactTitle dirty={dirty}>
      <div className={SECTION}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-heading-sm font-extrabold">#{order.orderNumber}</span>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </div>
        <span className="text-body-sm text-muted">{formatDateTime(order.placedAt ?? order.createdAt)}{method ? ` · ${METHOD_LABEL[method]}` : ""}</span>
        <ol aria-label="Progress" className="mt-1 flex gap-1">
          {PROGRESS_STEPS.map((label, i) => (
            <li key={label} className={cn("flex flex-1 flex-col gap-1 text-micro font-bold", i < done ? "text-ink" : "text-muted")}>
              <span aria-hidden="true" className={cn("h-1.5 rounded-[3px]", i < done ? "bg-primary" : "bg-surface-blush")} />
              {label}
              <span className="sr-only">{i < done ? " (done)" : " (to come)"}</span>
            </li>
          ))}
        </ol>

        {problem ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
            <span>{problem}</span>
          </div>
        ) : null}

        {step && (step.kind === "confirm" ? canConfirm : canFulfil) ? (
          <>
            <Button size="lg" fullWidth className="mt-1 h-[50px] text-body-lg" loading={advance.isPending} disabled={blocked} aria-describedby={blocked ? "rider-needed" : undefined} onClick={onNext}>{step.label}</Button>
            {blocked ? <span id="rider-needed" className="text-center text-caption text-muted">Choose a rider first</span> : <span className="text-center text-caption text-muted">The customer gets a text{order.email ? " and email" : ""} update automatically.</span>}
          </>
        ) : null}
      </div>

      <div className={SECTION}>
        <h3 className="font-extrabold">Items</h3>
        <ul className="flex flex-col gap-2.5">
          {detail.items.map((i) => (
            <li key={i.id} className="flex items-center gap-2.5">
              <Media image={i.image} alt="" aspect="5 / 6" sizes="40px" className="w-10 shrink-0 rounded-[10px]" />
              <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                <span className="font-semibold">{i.titleSnapshot}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span>
                <span className="text-caption text-muted">{[...Object.values(i.optionsSnapshot), i.skuSnapshot].join(" · ")}</span>
              </span>
              <span className="font-bold">{formatNaira(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-dashed border-line pt-2 text-body-sm">
          {totals.map((t) => (
            <div key={t.label} className={cn("flex justify-between", t.tone === "discount" && "font-semibold text-success", t.tone === "strong" && "font-extrabold")}>
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3 border-b border-line-soft px-[18px] py-4">
        <section aria-label="Customer" className={CARD}>
          <span aria-hidden="true" className={CARD_TITLE}>CUSTOMER</span>
          {customer.id && canSeeCustomer ? <Link href={`/admin/customers?customer=${customer.id}`} className="font-bold text-ink underline-offset-2 hover:underline">{a.recipientName ?? formatPhone(customer.phone)}</Link> : <span className="font-bold">{a.recipientName ?? formatPhone(customer.phone)}</span>}
          <span>{formatPhone(customer.phone)}</span>
          {customer.email ? <span className="break-all text-muted">{customer.email}</span> : null}
          <span className="text-muted">{customerLine(customer.paidOrders, customer.lifetimeValueMinor, formatNairaK)}</span>
          <Button href={whatsappLink(customer.phone)} target="_blank" rel="noopener noreferrer" variant="dark" size="sm" className="mt-1 self-start">Message on WhatsApp</Button>
        </section>

        <section aria-label="Delivery" className={CARD}>
          <span aria-hidden="true" className={CARD_TITLE}>DELIVERY</span>
          <span className="font-bold">{order.deliveryMethod === "pickup" ? "Pickup" : "Delivery"}{delivery?.zone ? ` · ${delivery.zone}` : ""}</span>
          <span>{order.deliveryMethod === "pickup" ? "Collected from the studio" : addressLines(a) || "No address"}</span>
          {a.landmark ? <span className="text-muted">Near {a.landmark}</span> : null}
          {order.deliveryMethod !== "pickup" ? (
            canFulfil && !closed ? (
              <form onSubmit={submitRider} className="mt-1 flex flex-col gap-1.5">
                <label className="flex flex-col gap-0.5 text-caption font-semibold">Rider
                  <input value={rider.name} onChange={(e) => setRider((r) => ({ ...r, name: e.target.value }))} placeholder="Name" className="h-[34px] rounded-md border-[1.5px] border-line-strong bg-surface px-2 font-normal" />
                </label>
                <label className="flex flex-col gap-0.5 text-caption font-semibold">Rider phone
                  <input type="tel" value={rider.phone} onChange={(e) => { setRider((r) => ({ ...r, phone: e.target.value })); setRiderError(undefined); }} placeholder="0803 123 4567" aria-invalid={riderError ? true : undefined} className="h-[34px] rounded-md border-[1.5px] border-line-strong bg-surface px-2 font-normal" />
                </label>
                {riderError ? <span role="alert" className="text-caption font-medium text-danger">{riderError}</span> : null}
                <Button type="submit" size="sm" variant="outline" className="self-start" loading={saveRider.isPending} disabled={!riderDirty}>Save rider</Button>
              </form>
            ) : (
              <span className="text-muted">Rider: {delivery?.riderName ? `${delivery.riderName}${delivery.riderPhoneE164 ? ` · ${formatPhone(delivery.riderPhoneE164)}` : ""}` : "none assigned"}</span>
            )
          ) : null}
        </section>
      </div>

      <div className={cn(SECTION, "border-b-0")}>
        <h3 className="font-extrabold">Activity</h3>
        <ol className="flex flex-col gap-2.5">
          {log.map((l) => (
            <li key={l.id} className="flex gap-2.5 text-body-sm">
              <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", l.internal ? "bg-ink-soft" : "bg-primary")} />
              <span className="flex-1">{l.text}{l.detail ? <>{l.internal ? ": " : " · "}<span className={l.internal ? "" : "text-muted"}>{l.detail}</span></> : null}</span>
              <time dateTime={l.at} className="shrink-0 text-muted">{formatDateTime(l.at)}</time>
            </li>
          ))}
        </ol>
        <form onSubmit={submitNote} className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Internal note</span>
            <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note (customers can't see this)" className="h-[42px] w-full rounded-pill border-[1.5px] border-line-strong bg-surface px-3.5 text-body-sm" />
          </label>
          <Button type="submit" variant="dark" loading={addNote.isPending} disabled={!note.trim()}>Add</Button>
        </form>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => window.print()}>Print packing slip</Button>
          {canRefundNow ? <Button variant="outline" size="sm" onClick={() => setDialog("refund")}>Refund</Button> : null}
          {canCancelNow ? <Button variant="danger-soft" size="sm" onClick={() => setDialog("cancel")}>Cancel order</Button> : null}
        </div>
      </div>

      <PackingSlip detail={detail} />
      {dialog === "transfer" ? <ConfirmTransferDialog open detail={detail} onCancel={() => setDialog(null)} onDone={finished} /> : null}
      {dialog === "refund" ? <RefundDialog open detail={detail} onCancel={() => setDialog(null)} onDone={finished} /> : null}
      {dialog === "cancel" ? <CancelDialog open detail={detail} onCancel={() => setDialog(null)} onDone={finished} /> : null}
    </SideDrawer>
  );
}
