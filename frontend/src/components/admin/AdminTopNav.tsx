"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminLogout, getOrdersToAction, getPendingReviewCount } from "@/lib/api/admin";
import { adminKeys } from "@/lib/admin/keys";
import { activeNavKey, ordersNeedingAction, visibleNav } from "@/lib/admin/nav";
import { permits } from "@/lib/admin/permissions";
import { cn } from "@/lib/cn";
import { useAdminSession } from "@/lib/stores/session";

const BADGE_REFRESH_MS = 60_000;

const initials = (email: string) => email.slice(0, 2).toUpperCase();

/**
 * The bar across the top of every admin screen: brand, one pill per section the signed-in role can use (the active one
 * filled dark), count badges where something waits on a person, and the account menu. Below 768px the links fold
 * into a Menu button.
 */
export function AdminTopNav() {
  const admin = useAdminSession((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The phone menu is open for one page only: moving to another page closes it without any effect.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menu = menuFor === pathname;
  const [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const held = admin?.permissions ?? [];
  const items = visibleNav(held);
  const active = activeNavKey(pathname);

  const orders = useQuery({
    queryKey: adminKeys.ordersToAction,
    queryFn: ({ signal }) => getOrdersToAction({ signal }),
    enabled: permits(held, "orders:read"),
    // Counts are always worth refreshing when the admin returns to the tab (and it is how a revoked session is noticed).
    staleTime: 0,
    refetchInterval: BADGE_REFRESH_MS,
    select: ordersNeedingAction,
  });
  const reviews = useQuery({
    queryKey: [...adminKeys.badges, "reviews"],
    queryFn: ({ signal }) => getPendingReviewCount({ signal }),
    enabled: permits(held, "reviews:moderate"),
    staleTime: 0,
    refetchInterval: BADGE_REFRESH_MS,
  });
  const counts = { orders: orders.data ?? 0, reviews: reviews.data ?? 0 };

  // The account menu closes when a click lands elsewhere or Escape is pressed.
  useEffect(() => {
    if (!account) return;
    const away = (e: MouseEvent) => !accountRef.current?.contains(e.target as Node) && setAccount(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAccount(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [account]);

  async function signOut() {
    await adminLogout();
    queryClient.removeQueries({ queryKey: adminKeys.all });
    router.replace("/admin/login");
  }

  return (
    <header className="border-b border-line bg-surface px-[clamp(16px,3vw,36px)] py-3">
      <div className="mx-auto flex max-w-admin flex-wrap items-center gap-x-5 gap-y-3">
        <Link href="/admin" className="flex items-center gap-2">
          <span aria-hidden="true" className="flex size-[34px] items-center justify-center rounded-[11px] bg-primary font-display text-heading-xs font-extrabold text-on-primary">J</span>
          <span className="font-display text-heading-xs font-extrabold">jetty admin</span>
        </Link>

        <button type="button" aria-expanded={menu} aria-controls="admin-nav" onClick={() => setMenuFor(menu ? null : pathname)} className="ml-auto inline-flex h-10 items-center gap-2 rounded-pill bg-surface-tint px-4 text-body-sm font-semibold md:hidden">
          <Menu aria-hidden="true" size={16} /> Menu
        </button>

        <nav id="admin-nav" aria-label="Admin" className={cn("order-last basis-full flex-wrap gap-1 md:order-none md:flex md:flex-1 md:basis-auto", menu ? "flex" : "hidden")}>
          {items.map((item) => {
            const count = item.badge ? counts[item.badge] : 0;
            const current = active === item.key;
            return (
              <Link key={item.key} href={item.href} aria-current={current ? "page" : undefined} className={cn("flex h-[38px] items-center gap-1.5 rounded-pill px-3.5 text-body-sm font-semibold", current ? "bg-surface-inverse text-on-inverse" : "text-ink hover:bg-surface-tint")}>
                {item.label}
                {count > 0 ? (
                  <>
                    <span aria-hidden="true" className="rounded-full bg-primary px-1.5 text-micro font-bold text-on-primary">{count > 99 ? "99+" : count}</span>
                    <span className="sr-only">, {count} to action</span>
                  </>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div ref={accountRef} className="relative">
          <button type="button" aria-expanded={account} aria-haspopup="menu" onClick={() => setAccount((a) => !a)} className="flex size-10 items-center justify-center rounded-full bg-pink-350 text-label font-extrabold text-primary-deep">
            <span aria-hidden="true">{admin ? initials(admin.email) : ""}</span>
            <span className="sr-only">Account menu</span>
          </button>
          {account ? (
            <div role="menu" className="absolute right-0 top-12 z-40 flex w-64 flex-col gap-1 rounded-lg border border-line bg-surface p-2 shadow-panel">
              <div className="px-3 py-2">
                <p className="truncate text-body-sm font-bold">{admin?.email}</p>
                <p className="text-caption capitalize text-muted">{admin?.roles.join(", ").replace(/_/g, " ")}</p>
              </div>
              <button type="button" role="menuitem" onClick={signOut} className="flex h-10 items-center gap-2 rounded-md px-3 text-left text-body-sm font-semibold hover:bg-surface-tint"><LogOut aria-hidden="true" size={16} /> Sign out</button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
