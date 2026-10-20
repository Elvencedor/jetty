import { Plus, Star } from "lucide-react";
import Link from "next/link";
import { Badge, BADGE_KIND_FOR, Media, Skeleton, type BadgeKind } from "@/components/ui";
import type { ProductCard as Card } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";
import { WishlistButton } from "./WishlistButton";

export type CardLayout = "grid" | "pick" | "list";

export function priceLabel(price: Card["price"]): string {
  return price.minAmountMinor === price.maxAmountMinor ? formatNaira(price.minAmountMinor) : `From ${formatNaira(price.minAmountMinor)}`;
}

function Dots({ colours }: { colours: Card["colours"] }) {
  if (!colours.length) return null;
  const shown = colours.slice(0, 4);
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`Colours: ${colours.map((c) => c.label).join(", ")}`}>
      {shown.map((c) => (
        <span key={c.valueKey} className="size-3.5 rounded-full border border-white shadow-swatch-inset" style={{ background: c.swatch ?? "var(--color-line-strong)" }} />
      ))}
      {colours.length > shown.length ? <span aria-hidden="true" className="text-micro font-semibold text-muted">+{colours.length - shown.length}</span> : null}
    </span>
  );
}

function Rating({ rating }: { rating: Card["rating"] }) {
  if (!rating.count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-caption font-semibold text-ink-soft">
      <Star aria-hidden="true" size={12} className="fill-warning text-warning" />
      <span aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} reviews`}>{rating.average.toFixed(1)}</span>
    </span>
  );
}

/** The single badge worth showing: sold out beats the product's own badges. */
function mainBadge(product: Card) {
  if (!product.inStock) return { label: "Sold out", kind: "bogo" as BadgeKind };
  const first = product.badges[0];
  return first ? { label: first.label, kind: BADGE_KIND_FOR[first.kind] ?? "highlight" } : null;
}

/**
 * One product in a listing. The whole card is a link to the product page (a stretched anchor); the heart sits above it.
 * `pick` is the home page's framed variant with a "+" that opens the product page (wigs need options chosen first).
 */
export function ProductCard({ product, layout = "grid", priority = false, tone = 0, sizes, heading: Heading = "h3" }: { product: Card; layout?: CardLayout; priority?: boolean; tone?: number; sizes?: string; /** Heading level of the title: h2 on pages whose title is an h1, h3 under a section heading. */ heading?: "h2" | "h3" }) {
  const href = `/p/${product.slug}`;
  const badge = mainBadge(product);
  const lengths = product.lengthRange ? (product.lengthRange.min === product.lengthRange.max ? `${product.lengthRange.min}"` : `${product.lengthRange.min}–${product.lengthRange.max}"`) : null;
  const image = product.image ?? null;
  const alt = image?.altText || product.title;

  if (layout === "list") {
    return (
      <article className="relative flex gap-3 rounded-card border border-line-soft p-2">
        <Media image={image} alt="" aspect="96 / 116" tone={tone} sizes="96px" className="w-24 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
          {badge ? <Badge kind={badge.kind}>{badge.label}</Badge> : null}
          <Heading className="line-clamp-2 text-body-sm font-semibold text-ink">
            <Link href={href} className="after:absolute after:inset-0">{product.title}</Link>
          </Heading>
          <p className="text-caption text-muted">
            {[product.rating.count ? `★ ${product.rating.average.toFixed(1)}` : null, lengths].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-auto flex items-center justify-between gap-2">
            <p className="font-display text-body font-extrabold text-ink">{priceLabel(product.price)}</p>
            <WishlistButton slug={product.slug} title={product.title} className="-my-2 -mr-1.5" />
          </div>
        </div>
      </article>
    );
  }

  const picked = layout === "pick";
  return (
    <article className={cn("relative flex flex-col gap-2", picked && "rounded-card bg-surface-subtle p-2")}>
      <div className="relative">
        <Media image={image} alt={alt} aspect="1 / 1.25" tone={tone} priority={priority} sizes={sizes ?? "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"} />
        {badge ? <Badge kind={badge.kind} className="absolute left-2 top-2">{badge.label}</Badge> : null}
        <WishlistButton slug={product.slug} title={product.title} className="absolute right-0 top-0" />
        <div className="absolute bottom-2 left-2"><Dots colours={product.colours} /></div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-1 pb-1">
        <Heading className="line-clamp-2 text-body-sm font-semibold text-ink">
          <Link href={href} className="after:absolute after:inset-0">{product.title}</Link>
        </Heading>
        <div className="mt-auto flex items-center justify-between gap-2">
          <p className="font-display text-body font-extrabold text-ink">{priceLabel(product.price)}</p>
          {picked ? (
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-primary text-on-primary"><Plus size={20} /></span>
          ) : (
            <Rating rating={product.rating} />
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton({ layout = "grid" }: { layout?: CardLayout }) {
  if (layout === "list") {
    return (
      <div aria-hidden="true" className="flex gap-3 rounded-card border border-line-soft p-2">
        <Skeleton className="h-[116px] w-24 rounded-lg" />
        <div className="flex-1 space-y-2 py-1"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/3" /></div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <Skeleton className="aspect-[1/1.25] rounded-lg" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}
