import type { StatusTone } from "@/components/ui/StatusPill";
import type { OrderStatusValue } from "@/lib/api/types";

type Pill = { tone: StatusTone; label: string };

/** Order status as staff and customers see it. */
export const ORDER_STATUS: Record<OrderStatusValue, Pill> = {
  pending_payment: { tone: "warning", label: "Awaiting payment" },
  placed: { tone: "primary", label: "Paid · to pack" },
  packed: { tone: "blush", label: "Packed" },
  out_for_delivery: { tone: "info", label: "Out for delivery" },
  delivered: { tone: "success", label: "Delivered" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  refunded: { tone: "neutral", label: "Refunded" },
  payment_exception: { tone: "danger", label: "Needs attention" },
};

export const PRODUCT_STATUS: Record<string, Pill> = {
  active: { tone: "success", label: "Active" },
  draft: { tone: "neutral", label: "Draft" },
  archived: { tone: "neutral", label: "Hidden" },
  out_of_stock: { tone: "danger", label: "Out of stock" },
};

export const REVIEW_STATUS: Record<string, Pill> = {
  pending: { tone: "warning", label: "Waiting" },
  approved: { tone: "success", label: "Published" },
  rejected: { tone: "neutral", label: "Rejected" },
  hidden: { tone: "neutral", label: "Hidden" },
};

export const PROMOTION_STATUS: Record<string, Pill> = {
  live: { tone: "primary", label: "Live" },
  scheduled: { tone: "info", label: "Scheduled" },
  ended: { tone: "neutral", label: "Ended" },
  draft: { tone: "neutral", label: "Draft" },
  inactive: { tone: "neutral", label: "Inactive" },
};

/** Customer-facing progress for the five-step order tracker. */
export const TRACKER_STEPS = ["Placed", "Paid", "Packed", "On the way", "Delivered"] as const;

/** How many of the five tracker steps are complete for an order status (0 when nothing has happened yet). */
export function trackerProgress(status: OrderStatusValue): number {
  switch (status) {
    case "pending_payment":
      return 1;
    case "placed":
      return 2;
    case "packed":
      return 3;
    case "out_for_delivery":
      return 4;
    case "delivered":
      return 5;
    default:
      return 0;
  }
}
