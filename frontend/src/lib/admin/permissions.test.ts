import { describe, expect, it } from "vitest";
import { activeNavKey, ordersNeedingAction, safeAdminNext, visibleNav } from "./nav";
import { permits, permitsAny } from "./permissions";

describe("permits (mirrors the API rule)", () => {
  it("lets * do everything, and write imply read", () => {
    expect(permits(["*"], "orders:refund")).toBe(true);
    expect(permits(["catalog:write"], "catalog:read")).toBe(true);
    expect(permits(["catalog:read"], "catalog:write")).toBe(false);
    expect(permits(["orders:read"], "orders:refund")).toBe(false);
    expect(permits([], "orders:read")).toBe(false);
  });
  it("only read-style permissions are implied by write", () => {
    expect(permits(["orders:write"], "orders:fulfil")).toBe(false);
    expect(permits(["reviews:moderate"], "reviews:read")).toBe(false);
  });
  it("accepts any one of several, and anyone when none are needed", () => {
    expect(permitsAny(["customers:read"], ["orders:read", "customers:read"])).toBe(true);
    expect(permitsAny([], [])).toBe(true);
    expect(permitsAny(["customers:read"], ["orders:read"])).toBe(false);
  });
});

describe("the admin nav per role", () => {
  const labels = (held: string[]) => visibleNav(held).map((i) => i.label);
  it("shows an owner everything", () => {
    expect(labels(["*"])).toEqual(["Overview", "Orders", "Products", "Customers", "Promotions", "Storefront", "Reviews", "Settings"]);
  });
  it("shows the seeded roles only what they can use", () => {
    expect(labels(["orders:read", "orders:fulfil", "inventory:read"])).toEqual(["Overview", "Orders"]);
    expect(labels(["orders:read", "customers:read", "reviews:moderate"])).toEqual(["Overview", "Orders", "Customers", "Reviews"]);
    expect(labels(["content:write", "catalog:read"])).toEqual(["Overview", "Products", "Storefront"]);
    expect(labels(["catalog:write", "orders:write", "promotions:write", "content:write", "customers:read", "analytics:read", "inventory:write", "reviews:moderate", "settings:read", "orders:refund"])).toEqual(["Overview", "Orders", "Products", "Customers", "Promotions", "Storefront", "Reviews", "Settings"]);
  });
  it("marks the right item active for nested paths", () => {
    expect(activeNavKey("/admin")).toBe("overview");
    expect(activeNavKey("/admin/orders")).toBe("orders");
    expect(activeNavKey("/admin/orders/abc")).toBe("orders");
    expect(activeNavKey("/admin/ordersx")).toBeUndefined();
    expect(activeNavKey("/shop")).toBeUndefined();
  });
});

describe("ordersNeedingAction", () => {
  it("counts what waits on a person, not orders already with a rider", () => {
    expect(ordersNeedingAction({ toPack: 3, toDispatch: 2, awaitingTransfer: 1, paymentExceptions: 1 })).toBe(7);
  });
});

describe("safeAdminNext", () => {
  it("only returns to places inside the admin", () => {
    expect(safeAdminNext("/admin/orders?order=abc")).toBe("/admin/orders?order=abc");
    expect(safeAdminNext("/admin")).toBe("/admin");
    for (const bad of ["https://evil.example", "//evil.example", "/shop", "/administrator", "/admin\\x", "/admin/login", "", null, undefined]) expect(safeAdminNext(bad as string)).toBe("/admin");
  });
});
