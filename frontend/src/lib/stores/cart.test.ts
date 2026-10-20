import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { API_MAX_CODES, API_MAX_LINES, API_MAX_LINE_QUANTITY, normaliseCode, useCartCount, useCartStore } from "./cart";
import { rehydrateAll } from "./persisted";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const cart = () => useCartStore.getState();

describe("cart store", () => {
  it("adds, merges duplicates and clamps quantities to what the API accepts", () => {
    cart().add(A);
    cart().add(A, 2);
    cart().add(B, 500);
    expect(cart().lines).toEqual([
      { variantId: A, quantity: 3 },
      { variantId: B, quantity: API_MAX_LINE_QUANTITY },
    ]);
    cart().add(B, 5);
    expect(cart().lines[1]!.quantity).toBe(API_MAX_LINE_QUANTITY);
    cart().add(A, -10);
    expect(cart().lines[0]!.quantity).toBe(1);
  });

  it("sets exact quantities, never below one", () => {
    cart().add(A, 4);
    cart().setQuantity(A, 2);
    expect(cart().lines[0]!.quantity).toBe(2);
    cart().setQuantity(A, 0);
    expect(cart().lines[0]!.quantity).toBe(1);
    cart().setQuantity(B, 3);
    expect(cart().lines).toHaveLength(1);
  });

  it("stops at the API's maximum number of lines", () => {
    for (let i = 0; i < API_MAX_LINES + 5; i++) cart().add(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(cart().lines).toHaveLength(API_MAX_LINES);
  });

  it("removes a line and puts it back in the same place for Undo", () => {
    cart().add(A, 2);
    cart().add(B, 1);
    const removed = cart().remove(A);
    expect(removed).toEqual({ line: { variantId: A, quantity: 2 }, index: 0 });
    expect(cart().lines.map((l) => l.variantId)).toEqual([B]);
    cart().restore(removed!.line, removed!.index);
    expect(cart().lines.map((l) => l.variantId)).toEqual([A, B]);
    cart().restore({ variantId: A, quantity: 9 }, 0);
    expect(cart().lines).toHaveLength(2);
    expect(cart().remove("33333333-3333-4333-8333-333333333333")).toBeUndefined();
  });

  it("keeps promotion codes upper-case, unique and limited", () => {
    cart().addCode(" welcome10 ");
    cart().addCode("WELCOME10");
    cart().addCode("   ");
    expect(cart().promotionCodes).toEqual(["WELCOME10"]);
    for (let i = 0; i < 10; i++) cart().addCode(`CODE${i}`);
    expect(cart().promotionCodes).toHaveLength(API_MAX_CODES);
    cart().removeCode("welcome10");
    expect(cart().promotionCodes).not.toContain("WELCOME10");
    expect(normaliseCode(" ab-1 ")).toBe("AB-1");
  });

  it("empties the bag", () => {
    cart().add(A);
    cart().addCode("X1");
    cart().clear();
    expect(cart().lines).toEqual([]);
    expect(cart().promotionCodes).toEqual([]);
  });
});

describe("cart persistence", () => {
  it("writes only variant ids, quantities and codes to storage", () => {
    cart().add(A, 2);
    cart().addCode("save10");
    const stored = JSON.parse(window.localStorage.getItem("jh.cart.v1")!);
    expect(stored.version).toBe(1);
    expect(stored.state).toEqual({ lines: [{ variantId: A, quantity: 2 }], promotionCodes: ["SAVE10"] });
  });

  it("restores the bag after a reload, once the app asks it to", () => {
    window.localStorage.setItem("jh.cart.v1", JSON.stringify({ version: 1, state: { lines: [{ variantId: A, quantity: 3 }], promotionCodes: ["SAVE10"] } }));
    expect(cart().lines).toEqual([]); // not before hydration, so the first render matches the server
    rehydrateAll();
    expect(cart().lines).toEqual([{ variantId: A, quantity: 3 }]);
    expect(cart().promotionCodes).toEqual(["SAVE10"]);
  });

  it.each([
    ["not json", "{nope"],
    ["wrong shape", JSON.stringify({ version: 1, state: { lines: "lots" } })],
    ["an id that is not a UUID", JSON.stringify({ version: 1, state: { lines: [{ variantId: "<script>", quantity: 1 }], promotionCodes: [] } })],
    ["a quantity the API would reject", JSON.stringify({ version: 1, state: { lines: [{ variantId: A, quantity: 5000 }], promotionCodes: [] } })],
    ["a zero quantity", JSON.stringify({ version: 1, state: { lines: [{ variantId: A, quantity: 0 }], promotionCodes: [] } })],
  ])("discards stored data that is %s rather than sending it to the API", (_name, raw) => {
    window.localStorage.setItem("jh.cart.v1", raw);
    rehydrateAll();
    expect(cart().lines).toEqual([]);
    expect(cart().promotionCodes).toEqual([]);
  });

  it("drops a stored bag with more lines or codes than the API accepts", () => {
    const lines = Array.from({ length: API_MAX_LINES + 1 }, (_, i) => ({ variantId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
    window.localStorage.setItem("jh.cart.v1", JSON.stringify({ version: 1, state: { lines, promotionCodes: [] } }));
    rehydrateAll();
    expect(cart().lines).toEqual([]);
    window.localStorage.setItem("jh.cart.v1", JSON.stringify({ version: 1, state: { lines: [], promotionCodes: Array.from({ length: API_MAX_CODES + 1 }, (_, i) => `C${i}`) } }));
    rehydrateAll();
    expect(cart().promotionCodes).toEqual([]);
  });

  it("accepts upper-case UUIDs, which are the same identifier", () => {
    const upper = A.toUpperCase();
    window.localStorage.setItem("jh.cart.v1", JSON.stringify({ version: 1, state: { lines: [{ variantId: upper, quantity: 1 }], promotionCodes: [] } }));
    rehydrateAll();
    expect(cart().lines).toHaveLength(1);
  });

  it("follows changes made in another tab", () => {
    cart().add(A);
    window.localStorage.setItem("jh.cart.v1", JSON.stringify({ version: 1, state: { lines: [{ variantId: B, quantity: 2 }], promotionCodes: [] } }));
    rehydrateAll();
    expect(cart().lines).toEqual([{ variantId: B, quantity: 2 }]);
  });
});

describe("useCartCount", () => {
  it("is the total number of units, and zero before the store has hydrated", () => {
    window.localStorage.setItem("jh.cart.v1", JSON.stringify({ version: 1, state: { lines: [{ variantId: A, quantity: 2 }, { variantId: B, quantity: 3 }], promotionCodes: [] } }));
    const { result } = renderHook(() => useCartCount());
    expect(result.current).toBe(0);
    act(() => rehydrateAll());
    expect(result.current).toBe(5);
    act(() => cart().add(A));
    expect(result.current).toBe(6);
  });
});
