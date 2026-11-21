import Link from "next/link";
import { Button } from "@/components/ui";
import { itemLabel, itemProblem, type UnavailableItem } from "@/lib/checkout/unavailable";

/**
 * Items the shop can no longer sell, named, with a way to deal with each. The price quote fails as a whole while one is in
 * the bag, so without this the customer sees only that "prices couldn't update" and cannot tell why or what to do.
 * In the bag each can be removed here; elsewhere (`onRemove` left out) it points back to the bag.
 */
export function UnavailableNotice({ items, onRemove, onRemoveAll }: { items: UnavailableItem[]; onRemove?: (variantId: string) => void; onRemoveAll?: () => void }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
      <p className="font-bold">{items.length === 1 ? "An item in your bag isn't available any more" : `${items.length} items in your bag aren't available any more`}</p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.variantId} className="flex items-center justify-between gap-3">
            <span className="min-w-0">{itemProblem(item)}</span>
            {onRemove ? <Button size="sm" variant="outline" aria-label={`Remove ${itemLabel(item)} from your bag`} onClick={() => onRemove(item.variantId)}>Remove</Button> : null}
          </li>
        ))}
      </ul>
      {onRemove ? (
        <p className="text-ink-soft">Remove {items.length === 1 ? "it" : "them"} to see your total and check out.{items.length > 1 && onRemoveAll ? <> <button type="button" onClick={onRemoveAll} className="font-semibold text-danger underline">Remove all</button></> : null}</p>
      ) : (
        <Link href="/bag" className="font-semibold underline self-start">Review your bag</Link>
      )}
    </div>
  );
}
