import { describe, expect, it } from "vitest";
import { adminKeys } from "./keys";
import { activeNavKey, ADMIN_NAV, ordersNeedingAction, safeAdminNext, visibleNav } from "./nav";
import { permits, permitsAny } from "./permissions";

describe("adminKeys", () => {
  it("nests every key under 'admin' so sign-out can drop them all", () => {
    const keys = [adminKeys.me, adminKeys.badges, adminKeys.ordersToAction, adminKeys.resource("orders"), adminKeys.list("orders"), adminKeys.detail("orders", "1")];
    for (const k of keys) expect(k[0]).toBe("admin");
  });
  it("makes list and detail keys children of the resource key, for prefix invalidation", () => {
    const resource = adminKeys.resource("orders");
    expect(adminKeys.list("orders", { q: "x" }).slice(0, 2)).toEqual([...resource]);
    expect(adminKeys.detail("orders", "7").slice(0, 2)).toEqual([...resource]);
  });
  it("includes filters and ids in the key", () => {
    expect(adminKeys.list("orders", { status: "paid" })).toEqual(["admin", "orders", "list", { status: "paid" }]);
    expect(adminKeys.list("orders")).toEqual(["admin", "orders", "list", {}]);
    expect(adminKeys.detail("products", "p1")).toEqual(["admin", "products", "detail", "p1"]);
  });
});

describe("admin permissions", () => {
  it("lets * through and matches exact permissions", () => {
    expect(permits(["*"], "orders:write")).toBe(true);
    expect(permits(["orders:read"], "orders:read")).toBe(true);
    expect(permits(["orders:read"], "catalog:read")).toBe(false);
  });
  it("lets write imply read of the same area but not the reverse", () => {
    expect(permits(["catalog:write"], "catalog:read")).toBe(true);
    expect(permits(["catalog:read"], "catalog:write")).toBe(false);
    expect(permits(["orders:write"], "catalog:read")).toBe(false);
  });
  it("permitsAny treats an empty requirement as any signed-in admin", () => {
    expect(permitsAny([], [])).toBe(true);
    expect(permitsAny([], ["orders:read"])).toBe(false);
    expect(permitsAny(["orders:write"], ["catalog:read", "orders:read"])).toBe(true);
  });
});

describe("admin navigation", () => {
  it("shows only Overview to an admin with no permissions", () => {
    expect(visibleNav([]).map((i) => i.key)).toEqual(["overview"]);
  });
  it("shows everything to a super admin, in nav order", () => {
    expect(visibleNav(["*"]).map((i) => i.key)).toEqual(ADMIN_NAV.map((i) => i.key));
  });
  it("filters sections by the permissions held", () => {
    expect(visibleNav(["orders:read", "reviews:moderate"]).map((i) => i.key)).toEqual(["overview", "orders", "reviews"]);
    expect(visibleNav(["catalog:write"]).map((i) => i.key)).toContain("products");
  });
  it("gives each count badge to the right section", () => {
    expect(ADMIN_NAV.filter((i) => i.badge).map((i) => [i.key, i.badge])).toEqual([["orders", "orders"], ["reviews", "reviews"]]);
  });
  it("resolves the active section by longest matching href", () => {
    expect(activeNavKey("/admin")).toBe("overview");
    expect(activeNavKey("/admin/orders")).toBe("orders");
    expect(activeNavKey("/admin/orders/abc")).toBe("orders");
    expect(activeNavKey("/admin/products/new")).toBe("products");
    expect(activeNavKey("/admin/settings")).toBe("settings");
  });
  it("does not match lookalike prefixes or other areas", () => {
    expect(activeNavKey("/admin/ordersx")).toBeUndefined();
    expect(activeNavKey("/shop")).toBeUndefined();
  });
  it("counts everything waiting on a person for the Orders badge", () => {
    expect(ordersNeedingAction({ toPack: 2, toDispatch: 3, awaitingTransfer: 1, paymentExceptions: 4 })).toBe(10);
    expect(ordersNeedingAction({ toPack: 0, toDispatch: 0, awaitingTransfer: 0, paymentExceptions: 0 })).toBe(0);
  });
});

describe("safeAdminNext", () => {
  it("allows paths inside the admin, keeping the query", () => {
    expect(safeAdminNext("/admin")).toBe("/admin");
    expect(safeAdminNext("/admin/orders/123")).toBe("/admin/orders/123");
    expect(safeAdminNext("/admin/orders?status=paid")).toBe("/admin/orders?status=paid");
    expect(safeAdminNext("/admin?x=1")).toBe("/admin?x=1");
  });
  it("falls back to the admin home for anything else", () => {
    for (const bad of [null, undefined, "", "/", "/shop", "https://evil.com", "//evil.com", "/administrator", "/admin\\evil", "/admin/\u0000x", "/admin/\nx", "/admin/login", "/admin/login?next=/admin", `/admin/${"a".repeat(300)}`, "javascript:alert(1)"]) {
      expect(safeAdminNext(bad as string | null | undefined), String(bad)).toBe("/admin");
    }
  });
});
