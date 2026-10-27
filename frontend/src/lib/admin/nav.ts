import { permitsAny } from "./permissions";

export type AdminNavKey = "overview" | "orders" | "products" | "customers" | "promotions" | "storefront" | "reviews" | "settings";
export type AdminBadge = "orders" | "reviews";

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  href: string;
  /** The user needs any one of these; none means any signed-in admin. */
  needs: readonly string[];
  /** Which count to show beside the label. */
  badge?: AdminBadge;
  /** What the section is for, shown on screens that are not built yet. */
  blurb: string;
};

/**
 * The admin sections, in nav order. Each is shown only to roles that can use it (the API refuses the rest anyway).
 * "Team" from the design is absent: the API has no admin-user management yet.
 */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: "overview", label: "Overview", href: "/admin", needs: [], blurb: "How the shop is doing." },
  { key: "orders", label: "Orders", href: "/admin/orders", needs: ["orders:read"], badge: "orders", blurb: "Pack, dispatch and refund orders." },
  { key: "products", label: "Products", href: "/admin/products", needs: ["catalog:read"], blurb: "Products, variants, photos and stock." },
  { key: "customers", label: "Customers", href: "/admin/customers", needs: ["customers:read"], blurb: "Who has bought, and how much." },
  { key: "promotions", label: "Promotions", href: "/admin/promotions", needs: ["promotions:read"], blurb: "Discounts, codes and offers." },
  { key: "storefront", label: "Storefront", href: "/admin/storefront", needs: ["content:read"], blurb: "The home page, banners and info pages." },
  { key: "reviews", label: "Reviews", href: "/admin/reviews", needs: ["reviews:moderate"], badge: "reviews", blurb: "Approve or hide customer reviews." },
  { key: "settings", label: "Settings", href: "/admin/settings", needs: ["settings:read"], blurb: "Store details, delivery, payments." },
];

export const visibleNav = (held: readonly string[]) => ADMIN_NAV.filter((item) => permitsAny(held, item.needs));

/** The nav item a path belongs to (the longest matching href wins, so /admin/orders/x is Orders, not Overview). */
export function activeNavKey(pathname: string): AdminNavKey | undefined {
  return [...ADMIN_NAV].sort((a, b) => b.href.length - a.href.length).find((i) => (i.href === "/admin" ? pathname === "/admin" : pathname === i.href || pathname.startsWith(`${i.href}/`)))?.key;
}

/** What the Orders badge counts: everything waiting on a person (not orders already out with a rider). */
export const ordersNeedingAction = (c: { toPack: number; toDispatch: number; awaitingTransfer: number; paymentExceptions: number }) => c.toPack + c.toDispatch + c.awaitingTransfer + c.paymentExceptions;

/** Where to send an admin after signing in: only paths inside the admin, so a crafted link cannot send them elsewhere. */
export function safeAdminNext(next: string | null | undefined): string {
  if (!next || next.length > 300 || !/^\/admin(\/|\?|$)/.test(next) || next.includes("\\") || /[\u0000-\u001f]/.test(next) || next.startsWith("/admin/login")) return "/admin";
  return next;
}
