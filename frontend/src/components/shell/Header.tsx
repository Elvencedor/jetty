import { Heart, User } from "lucide-react";
import Link from "next/link";
import { BagLink } from "./BagLink";
import { SearchBox } from "./SearchBox";

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/shop?onOffer=1", label: "Deals" },
  { href: "/pages/size-guide", label: "Size guide" },
  { href: "/track", label: "Track order" },
];

/** Logo, search and bag. On wide screens it also carries the navigation the tab bar provides on phones. */
export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-surface/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-store items-center gap-3 px-4 py-2 lg:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-sm bg-primary font-display text-heading-xs font-extrabold text-on-primary">J</span>
          <span className="sr-only font-display text-heading-sm font-extrabold sm:not-sr-only">Jetty&rsquo;s Hair</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-5 lg:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-body-sm font-semibold text-ink-soft hover:text-primary-strong">
              {item.label}
            </Link>
          ))}
        </nav>
        <SearchBox className="min-w-0 flex-1 lg:mx-auto lg:max-w-md" />
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/saved" aria-label="Saved wigs" className="hidden size-11 items-center justify-center rounded-full bg-surface-tint text-ink hover:bg-surface-blush lg:inline-flex">
            <Heart aria-hidden="true" size={20} />
          </Link>
          <Link href="/account" aria-label="Account" className="hidden size-11 items-center justify-center rounded-full bg-surface-tint text-ink hover:bg-surface-blush lg:inline-flex">
            <User aria-hidden="true" size={20} />
          </Link>
          <BagLink />
        </div>
      </div>
    </header>
  );
}
