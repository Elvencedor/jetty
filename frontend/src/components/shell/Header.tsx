import { Heart, User } from "lucide-react";
import Link from "next/link";
import { BagLink } from "./BagLink";
import { SearchBox } from "./SearchBox";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/shop?onOffer=1", label: "Deals" },
  { href: "/pages/size-guide", label: "Size guide" },
  { href: "/track", label: "Track order" },
];

/**
 * The wide-screen header (from 1024px; the design only covers phones, where each page has its own header). Logo,
 * navigation, search and the account, saved and bag buttons.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-30 hidden border-b border-line-soft bg-surface/95 backdrop-blur lg:block">
      <div className="mx-auto flex w-full max-w-store items-center gap-6 px-4 py-2">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-5">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-body-sm font-semibold text-ink-soft hover:text-primary-strong">
              {item.label}
            </Link>
          ))}
        </nav>
        <SearchBox className="mx-auto min-w-0 max-w-md flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/saved" aria-label="Saved wigs" className="inline-flex size-11 items-center justify-center rounded-full bg-surface-tint text-ink hover:bg-surface-blush">
            <Heart aria-hidden="true" size={20} />
          </Link>
          <Link href="/account" aria-label="Account" className="inline-flex size-11 items-center justify-center rounded-full bg-surface-tint text-ink hover:bg-surface-blush">
            <User aria-hidden="true" size={20} />
          </Link>
          <BagLink />
        </div>
      </div>
    </header>
  );
}
