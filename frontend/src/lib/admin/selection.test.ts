import { beforeEach, describe, expect, it } from "vitest";
import { useAdminSession } from "@/lib/stores/session";
import { MAX_SELECTION, rangeBetween, selectAllState, useSelectionStore } from "./selection";

const item = (id: string) => ({ id, label: `Item ${id}` });
const store = () => useSelectionStore.getState();
const ids = (resource: string) => Object.keys(store().byResource[resource] ?? {});

beforeEach(() => useSelectionStore.setState({ byResource: {} }));

describe("the selection store", () => {
  it("keeps what was picked on one page while more is picked from another", () => {
    ["a", "b", "c", "d", "e"].forEach((id) => store().toggle("products", item(id))); // page 1
    ["f", "g"].forEach((id) => store().toggle("products", item(id))); // page 2
    expect(ids("products")).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("toggles an item off again, and keeps the rest in the order they were picked", () => {
    ["a", "b", "c"].forEach((id) => store().toggle("products", item(id)));
    store().toggle("products", item("b"));
    expect(ids("products")).toEqual(["a", "c"]);
  });

  it("keeps each kind of thing's selection apart", () => {
    store().toggle("products", item("p1"));
    store().toggle("categories", item("c1"));
    store().clear("products");
    expect(ids("products")).toEqual([]);
    expect(ids("categories")).toEqual(["c1"]);
  });

  it("adds and removes many at once, without disturbing the others", () => {
    store().toggle("products", item("keep"));
    store().setMany("products", ["a", "b", "c"].map(item), true);
    expect(ids("products")).toEqual(["keep", "a", "b", "c"]);
    store().setMany("products", ["a", "b"].map(item), false);
    expect(ids("products")).toEqual(["keep", "c"]);
    store().remove("products", ["c", "missing"]);
    expect(ids("products")).toEqual(["keep"]);
  });

  it("stops at the limit and says so, instead of quietly dropping some", () => {
    const many = Array.from({ length: MAX_SELECTION + 20 }, (_, i) => item(`i${i}`));
    const result = store().setMany("products", many, true);
    expect(result.limited).toBe(true);
    expect(ids("products")).toHaveLength(MAX_SELECTION);
    expect(store().toggle("products", item("one-more"))).toBe(false);
    expect(store().toggle("products", item("i0"))).toBe(true); // deselecting is always allowed
    expect(ids("products")).toHaveLength(MAX_SELECTION - 1);
  });

  it("refreshes the remembered name when an item is picked again", () => {
    store().setMany("products", [{ id: "a", label: "Old name" }], true);
    store().setMany("products", [{ id: "a", label: "New name" }], true);
    expect(store().byResource.products!.a!.label).toBe("New name");
  });
});

describe("signing out", () => {
  it("drops every selection, so the next admin on this browser starts clean", () => {
    useAdminSession.getState().setSession({ accessToken: "t", expiresIn: 900, user: { id: "a", email: "a@example.com", roles: ["owner"], permissions: [] } });
    store().toggle("products", item("a"));
    store().toggle("categories", item("c"));
    useAdminSession.getState().clear();
    expect(store().byResource).toEqual({});
  });
});

describe("range and select-all helpers", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("takes the items between two clicks, whichever way round", () => {
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "c", "c")).toEqual(["c"]);
  });
  it("falls back to the clicked item when the other end is not in the list", () => {
    expect(rangeBetween(order, "gone", "c")).toEqual(["c"]);
    expect(rangeBetween(order, "a", "gone")).toEqual([]);
  });
  it("describes the select-all box as none, some or all of what is shown", () => {
    expect(selectAllState(order, () => false)).toBe("none");
    expect(selectAllState(order, (id) => id === "a")).toBe("some");
    expect(selectAllState(order, () => true)).toBe("all");
    expect(selectAllState([], () => true)).toBe("none");
  });
});
