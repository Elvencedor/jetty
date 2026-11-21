import Link from "next/link";
import type { CheckoutFailure, FailureWhere } from "@/lib/checkout/errors";
import { itemAdvice, itemProblem, type UnavailableItem } from "@/lib/checkout/unavailable";

type Rich = { title?: string; where?: FailureWhere; items?: UnavailableItem[] };

/**
 * A failed order, said plainly: what happened, which items if it is about items, and a button that goes to where it is
 * fixed (the bag, the delivery step or the payment step) instead of leaving the customer to work it out.
 */
export function FailureNotice({ failure, onChange }: { failure: CheckoutFailure; onChange: (step: "delivery" | "payment") => void }) {
  const { title, where, items } = failure as CheckoutFailure & Rich;
  const action = "font-semibold underline self-start";
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
      {title ? <p className="font-bold">{title}</p> : null}
      <p>{failure.message}</p>
      {items && items.length > 1 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {items.map((item) => <li key={item.variantId}>{itemProblem(item)} {itemAdvice(item)}</li>)}
        </ul>
      ) : null}
      {where === "bag" ? <Link href="/bag" className={action}>Review your bag</Link> : null}
      {where === "delivery" ? <button type="button" onClick={() => onChange("delivery")} className={action}>Change delivery details</button> : null}
      {where === "payment" ? <button type="button" onClick={() => onChange("payment")} className={action}>Choose another payment method</button> : null}
    </div>
  );
}
