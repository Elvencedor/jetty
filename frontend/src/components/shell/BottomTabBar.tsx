"use client";

import { Heart, Home, LayoutGrid, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS: { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }[] = [
  { href: "/", label: "Home", icon: Home, match: (p) => p === "/" },
  { href: "/shop", label: "Shop", icon: LayoutGrid, match: (p) => p.startsWith("/shop") || p.startsWith("/search") || p.startsWith("/p/") },
  { href: "/saved", label: "Saved", icon: Heart, match: (p) => p.startsWith("/saved") },
  { href: "/account", label: "Me", icon: User, match: (p) => p.startsWith("/account") || p.startsWith("/track") },
];

/** Phone navigation, fixed to the bottom edge. Hidden from 1024px, where the header carries it. */
export function BottomTabBar() {
  const pathname = usePathname();
  // Checkout is a focused flow with its own bar at the bottom of the screen.
  if (pathname.startsWith("/checkout")) return null;
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const current = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link href={href} aria-current={current ? "page" : undefined} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-caption font-semibold", current ? "text-primary-strong" : "text-muted")}>
                <Icon aria-hidden="true" size={22} strokeWidth={current ? 2.5 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
