import { Plus } from "lucide-react";
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
        <span key={c.valueKey} className="size-3.5 rounded-full border-2 border-white" style={{ background: c.swatch ?? "var(--color-line-strong)" }} />
      ))}
      {colours.length > shown.length ? <span aria-hidden="true" className="rounded-full bg-white px-1 text-micro font-semibold text-ink">+{colours.length - shown.length}</span> : null}
    </span>
  );
}

/** The single badge worth showing: sold out beats the product's own badges. */
function mainBadge(product: Card) {
  if (!product.inStock) return { label: "Sold out", kind: "bogo" as BadgeKind };
  const first = product.badges[0];
  return first ? { label: first.label, kind: BADGE_KIND_FOR[first.kind] ?? "highlight" } : null;
}

const Price = ({ price, stacked = false }: { price: Card["price"]; stacked?: boolean }) => (
  <span className={cn("flex leading-tight", stacked ? "flex-col" : "items-baseline gap-1.5")}>
    <span className="font-display text-body-lg font-extrabold text-ink">{priceLabel(price)}</span>
    {price.compareAtMinor ? <s className="text-caption text-muted"><span className="sr-only">Was </span>{formatNaira(price.compareAtMinor)}</s> : null}
  </span>
);

const rating = (product: Card) => (product.rating.count ? `★ ${product.rating.average.toFixed(1)}` : null);

type Props = {
  product: Card;
  layout?: CardLayout;
  priority?: boolean;
  tone?: number;
  sizes?: string;
  /** Heading level of the title: h2 on pages whose title is an h1, h3 under a section heading. */
  heading?: "h2" | "h3";
};

/**
 * One product in a listing. The whole card is a link to the product page (a stretched anchor); the heart sits above it.
 * `pick` is the home page's framed variant with a "+" that opens the product page (wigs need options chosen first).
 */
export function ProductCard({ product, layout = "grid", priority = false, tone = 0, sizes, heading: Heading = "h3" }: Props) {
  const href = `/p/${product.slug}`;
  const badge = mainBadge(product);
  const lengths = product.lengthRange ? (product.lengthRange.min === product.lengthRange.max ? `${product.lengthRange.min}"` : `${product.lengthRange.min}–${product.lengthRange.max}"`) : null;
  const image = product.image ?? null;
  const alt = image?.altText || product.title;
  const title = (
    <Heading className="line-clamp-2 text-body-sm font-semibold leading-[1.3] text-ink">
      <Link href={href} className="after:absolute after:inset-0">{product.title}</Link>
    </Heading>
  );
  const plus = (
    <span aria-hidden="true" className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"><Plus size={18} strokeWidth={2.4} /></span>
  );

  if (layout === "list") {
    return (
      <article className="relative flex gap-3 rounded-lg bg-surface-subtle p-2">
        <Media image={image} alt="" aspect="96 / 116" tone={tone} sizes="96px" className="w-24 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
          {badge ? <Badge kind={badge.kind} className="self-start">{badge.label}</Badge> : null}
          {title}
          <p className="text-caption text-muted">{[rating(product), lengths].filter(Boolean).join(" · ")}</p>
          <div className="mt-auto flex items-center justify-between gap-2">
            <Price price={product.price} />
            {plus}
          </div>
        </div>
      </article>
    );
  }

  const picked = layout === "pick";
  return (
    <article className={cn("relative flex flex-col gap-2", picked && "rounded-card bg-surface-subtle p-2")}>
      <div className="relative">
        <Media image={image} alt={alt} aspect={picked ? "1 / 1.15" : "1 / 1.25"} tone={tone} priority={priority} sizes={sizes ?? "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"} className={picked ? "rounded-md" : "rounded-lg"} />
        {badge ? <Badge kind={badge.kind} className="absolute left-2.5 top-2.5">{badge.label}</Badge> : null}
        <WishlistButton slug={product.slug} title={product.title} className="absolute right-0.5 top-0.5" />
        <div className="absolute bottom-2.5 left-2.5"><Dots colours={product.colours} /></div>
      </div>
      {picked ? (
        <>
          <div className="flex flex-col gap-0.5 px-1">
            {title}
            {product.rating.count ? <p className="text-caption text-muted">★ {product.rating.average.toFixed(1)} · {product.rating.count} reviews</p> : null}
          </div>
          <div className="flex items-center justify-between px-1 pb-1">
            <Price price={product.price} stacked />
            {plus}
          </div>
        </>
      ) : (
        <>
          {title}
          <div className="flex items-baseline gap-1.5">
            <Price price={product.price} />
            {rating(product) ? <span role="img" aria-label={`Rated ${product.rating.average.toFixed(1)} out of 5 from ${product.rating.count} reviews`} className="ml-auto text-caption text-muted">{rating(product)}</span> : null}
          </div>
        </>
      )}
    </article>
  );
}

export function ProductCardSkeleton({ layout = "grid" }: { layout?: CardLayout }) {
  if (layout === "list") {
    return (
      <div aria-hidden="true" className="flex gap-3 rounded-lg bg-surface-subtle p-2">
        <Skeleton className="h-[116px] w-24 rounded-md" />
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
