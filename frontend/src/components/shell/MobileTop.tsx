import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { BagLink } from "./BagLink";
import { SearchBox } from "./SearchBox";
import { Wordmark } from "./Wordmark";

/** The home page's phone header: wordmark and bag, then the search field with a filters button into the shop. */
export function HomeTop() {
  return (
    <div className="lg:hidden">
      <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <Wordmark />
        <BagLink />
      </header>
      <div className="flex gap-2 px-4 pb-3 pt-1">
        <SearchBox size="lg" className="min-w-0 flex-1" />
        <Link href="/shop" aria-label="Filters" className="flex size-[50px] shrink-0 items-center justify-center rounded-full bg-surface-inverse text-on-inverse">
          <SlidersHorizontal aria-hidden="true" size={20} strokeWidth={1.8} />
        </Link>
      </div>
    </div>
  );
}
