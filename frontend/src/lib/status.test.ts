import { describe, expect, it } from "vitest";
import type { OrderStatusValue } from "./api/types";
import { ORDER_STATUS, trackerProgress, TRACKER_STEPS } from "./status";

describe("status helpers", () => {
  it("labels every order status the API can return", () => {
    const all: OrderStatusValue[] = ["pending_payment", "placed", "packed", "out_for_delivery", "delivered", "cancelled", "refunded", "payment_exception"];
    for (const status of all) expect(ORDER_STATUS[status].label.length).toBeGreaterThan(0);
  });

  it("maps statuses onto the five tracker steps", () => {
    expect(TRACKER_STEPS).toHaveLength(5);
    expect(
      (["pending_payment", "placed", "packed", "out_for_delivery", "delivered"] as const).map(trackerProgress),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(trackerProgress("cancelled")).toBe(0);
    expect(trackerProgress("refunded")).toBe(0);
  });
});
