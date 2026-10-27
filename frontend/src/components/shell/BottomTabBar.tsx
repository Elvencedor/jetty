"use client";

import { Heart, Home, LayoutGrid, ShoppingBag, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useCartCount } from "@/lib/stores/cart";

const TABS: { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }[] = [
  { href: "/", label: "Home", icon: Home, match: (p) => p === "/" },
  { href: "/shop", label: "Shop", icon: LayoutGrid, match: (p) => p.startsWith("/shop") || p.startsWith("/search") },
  { href: "/saved", label: "Saved", icon: Heart, match: (p) => p.startsWith("/saved") },
  { href: "/bag", label: "Bag", icon: ShoppingBag, match: (p) => p.startsWith("/bag") },
  { href: "/account", label: "Me", icon: User, match: (p) => p.startsWith("/account") || p.startsWith("/track") },
];

/** Pages with a bar of their own at the bottom of the screen, or a focused flow, do not show the tab bar. */
const HIDDEN_ON = ["/p/", "/bag", "/checkout", "/order/"];

/**
 * Phone navigation: a floating dark pill. The current tab grows into a pink pill with its label; the others are
 * icons only (their names are still spoken). Hidden from 1024px, where the header carries navigation.
 */
export function BottomTabBar() {
  const pathname = usePathname();
  const count = useCartCount();
  if (HIDDEN_ON.some((prefix) => pathname.startsWith(prefix))) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto h-16 max-w-xl rounded-pill bg-surface-inverse px-1.5 lg:hidden">
      <ul className="flex h-full items-center justify-around">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const current = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-label={href === "/bag" && count ? `Bag, ${count} ${count === 1 ? "item" : "items"}` : label}
                aria-current={current ? "page" : undefined}
                className={cn("relative flex h-12 min-w-12 items-center justify-center gap-1.5 rounded-pill text-label font-bold transition-colors duration-(--duration-base)", current ? "bg-primary px-4 text-on-primary" : "text-on-inverse-muted")}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
                {current ? <span>{label}</span> : null}
                {href === "/bag" && count && !current ? (
                  <span aria-hidden="true" className="absolute right-1 top-1 flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-micro font-bold text-on-primary">{count > 99 ? "99+" : count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
