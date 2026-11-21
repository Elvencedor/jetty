import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { itemAdvice, itemLabel, itemProblem, unavailableItems } from "./unavailable";

const err = (code: string, details?: unknown[]) => new ApiError(code === "OUT_OF_STOCK" ? 409 : 422, { code, message: "m", requestId: "r", ...(details ? { details } : {}) });

describe("unavailableItems", () => {
  it("reads which items are unavailable and why", () => {
    const items = unavailableItems(err("VARIANT_UNAVAILABLE", [
      { variantId: "a", productTitle: "Bone Straight Wig", optionSummary: '20" · HD', reason: "NOT_FOR_SALE" },
      { variantId: "b", productTitle: null, optionSummary: "", reason: "REMOVED" },
    ]));
    expect(items.map((i) => [i.variantId, i.name, i.options, i.reason])).toEqual([["a", "Bone Straight Wig", '20" · HD', "NOT_FOR_SALE"], ["b", null, "", "REMOVED"]]);
  });

  it("reads stock errors with how many were asked for and how many are left", () => {
    const [short] = unavailableItems(err("OUT_OF_STOCK", [{ variantId: "a", productTitle: "Wig", optionSummary: "", requestedQuantity: 3, availableQuantity: 1 }]));
    expect(short).toMatchObject({ reason: "NOT_ENOUGH", requested: 3, available: 1 });
    const [gone] = unavailableItems(err("OUT_OF_STOCK", [{ variantId: "a", productTitle: "Wig", availableQuantity: 0, requestedQuantity: 1 }]));
    expect(gone!.reason).toBe("SOLD_OUT");
  });

  it("still works with an older API that sends only the id", () => {
    const [item] = unavailableItems(err("VARIANT_UNAVAILABLE", [{ variantId: "a" }]));
    expect(item).toMatchObject({ variantId: "a", name: null, reason: "NOT_FOR_SALE" });
  });

  it("gives nothing for other errors, or details that are not items", () => {
    expect(unavailableItems(err("DELIVERY_UNAVAILABLE", [{ variantId: "a" }]))).toEqual([]);
    expect(unavailableItems(err("VARIANT_UNAVAILABLE", [{ nope: 1 }, null, "x"]))).toEqual([]);
    expect(unavailableItems(new Error("plain"))).toEqual([]);
  });
});

describe("saying what is wrong with an item", () => {
  const base = { variantId: "a", name: "Bone Straight Wig", options: '20" · HD', requested: null, available: null };
  it("names the item with its options", () => {
    expect(itemLabel({ ...base, reason: "NOT_FOR_SALE" })).toBe('Bone Straight Wig (20" · HD)');
    expect(itemLabel({ ...base, options: "", reason: "NOT_FOR_SALE" })).toBe("Bone Straight Wig");
    expect(itemLabel({ ...base, name: null, reason: "REMOVED" })).toBe("An item in your bag");
  });
  it("explains each reason in a sentence", () => {
    expect(itemProblem({ ...base, reason: "NOT_FOR_SALE" })).toBe('Bone Straight Wig (20" · HD) is no longer available.');
    expect(itemProblem({ ...base, reason: "REMOVED" })).toBe('Bone Straight Wig (20" · HD) is no longer sold.');
    expect(itemProblem({ ...base, name: null, reason: "REMOVED" })).toBe("An item in your bag is no longer sold.");
    expect(itemProblem({ ...base, reason: "SOLD_OUT" })).toBe('Bone Straight Wig (20" · HD) has just sold out.');
    expect(itemProblem({ ...base, reason: "NOT_ENOUGH", requested: 3, available: 2 })).toBe('Only 2 of Bone Straight Wig (20" · HD) are left, and you asked for 3.');
    expect(itemProblem({ ...base, reason: "NOT_ENOUGH", requested: 3, available: 1 })).toBe('Only 1 of Bone Straight Wig (20" · HD) is left, and you asked for 3.');
  });
  it("says what to do: lower the quantity, or remove it", () => {
    expect(itemAdvice({ ...base, reason: "NOT_ENOUGH" })).toBe("Lower the quantity in your bag.");
    expect(itemAdvice({ ...base, reason: "SOLD_OUT" })).toBe("Remove it from your bag to continue.");
    expect(itemAdvice({ ...base, reason: "NOT_FOR_SALE" })).toBe("Remove it from your bag to continue.");
  });
});
