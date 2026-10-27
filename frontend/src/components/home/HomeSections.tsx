import { ArrowRight, BadgeCheck, Clock, Lock, RotateCcw, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Media } from "@/components/ui";
import type { HomeSection, Tone } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { FlashStrip } from "./FlashStrip";
import { PicksTabs } from "./PicksTabs";

type Hero = Extract<HomeSection, { type: "hero" }>["cards"][number];

/** Card colours by the tone the editor picked. `art` is the placeholder behind the photo; `tag` the pill; `cta` the button. */
const HERO_TONE: Record<Tone, { card: string; art: string; tag: string; cta: string }> = {
  pink: { card: "bg-primary text-on-primary", art: "bg-pink-300", tag: "bg-white text-primary-strong", cta: "bg-surface-inverse text-on-inverse" },
  blush: { card: "bg-surface-blush text-ink", art: "bg-pink-350", tag: "bg-surface-inverse text-on-inverse", cta: "bg-primary text-on-primary" },
  plum: { card: "bg-surface-inverse text-on-inverse", art: "bg-pink-800", tag: "bg-white text-primary-strong", cta: "bg-primary text-on-primary" },
  white: { card: "bg-surface text-ink border border-line", art: "bg-surface-blush", tag: "bg-surface-inverse text-on-inverse", cta: "bg-primary text-on-primary" },
};
const TILE_TONE: Record<Tone, { card: string; sub: string }> = {
  pink: { card: "bg-pink-300 text-ink", sub: "text-ink-soft" },
  blush: { card: "bg-surface-blush text-ink", sub: "text-ink-soft" },
  plum: { card: "bg-surface-inverse text-on-inverse", sub: "text-on-inverse-muted" },
  white: { card: "bg-surface text-ink border border-line", sub: "text-muted" },
};
const DEFAULT_TILES: Tone[] = ["pink", "blush", "plum"];

const ICONS: Record<string, LucideIcon> = { lock: Lock, shield: Lock, return: RotateCcw, truck: Truck, delivery: Truck, star: BadgeCheck, check: BadgeCheck, clock: Clock };

/** Only same-site paths from the CMS become links; anything else is dropped rather than trusted. */
const safePath = (url: string | undefined) => (url && /^\/(?!\/)/.test(url) ? url : undefined);

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-heading-md font-extrabold tracking-[-0.5px]">{title}</h2>
        {href ? <Link href={href} className="text-body-sm font-bold text-primary-strong">See all</Link> : null}
      </div>
      {children}
    </section>
  );
}

function Stories({ items }: { items: Extract<HomeSection, { type: "stories" }>["items"] }) {
  return (
    <nav aria-label="New drops" className="-mx-4">
      <ul className="flex snap-x gap-3.5 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none]">
        {items.map((s, i) => {
          const href = safePath(s.linkUrl);
          if (!href) return null;
          return (
            <li key={s.id} className="w-[72px] shrink-0 snap-start">
              <Link href={href} className="flex flex-col items-center gap-1.5 text-center text-caption font-semibold leading-[1.2]">
                <span className={cn("block size-[72px] rounded-full p-[3px]", s.highlight ? "bg-primary" : "bg-line-strong")}>
                  <span className="relative block size-full overflow-hidden rounded-full border-[3px] border-white">
                    <Media image={{ url: s.imageUrl ?? null }} alt="" aspect="1 / 1" tone={i} sizes="72px" className="absolute inset-0 !h-full rounded-none" />
                  </span>
                </span>
                {s.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function HeroCard({ card, first, tone }: { card: Hero; first: boolean; tone: (typeof HERO_TONE)[Tone] }) {
  const href = safePath(card.ctaUrl) ?? "/shop";
  return (
    // One link for the whole card, named by its headline; the button inside is only its visual.
    <Link href={href} className={cn("relative flex h-[380px] w-[320px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-xl p-[22px] sm:w-[360px] lg:w-auto", tone.card)}>
      <span aria-hidden="true" className={cn("absolute -bottom-7 -right-10 h-[290px] w-[230px] overflow-hidden rounded-b-card rounded-t-[120px]", tone.art)}>
        {card.imageUrl ? <Media image={{ url: card.imageUrl }} alt="" aspect="auto" priority={first} sizes="(min-width: 1024px) 50vw, 360px" className="absolute inset-0 !h-full rounded-none" /> : null}
      </span>
      {card.tag ? <span className={cn("relative self-start rounded-[14px] px-3 py-1.5 text-caption font-bold", tone.tag)}>{card.tag}</span> : <span />}
      <span className="relative flex max-w-[200px] flex-col gap-3.5">
        <span className="line-clamp-3 font-display text-display-lg font-extrabold">{card.headline}</span>
        {card.subheadline ? <span className="text-body-sm font-medium text-white">{card.subheadline}</span> : null}
        {card.ctaLabel ? (
          <span className={cn("inline-flex h-11 items-center gap-2 self-start rounded-pill px-[18px] text-body-sm font-bold", tone.cta)}>
            {card.ctaLabel}
            <ArrowRight aria-hidden="true" size={16} strokeWidth={2.2} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function Hero({ cards, now }: { cards: Hero[]; now: number }) {
  const live = cards.filter((c) => !c.endsAt || Date.parse(c.endsAt) > now);
  if (!live.length) return null;
  return (
    <section aria-label="Offers" className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
      {live.map((c, i) => <HeroCard key={c.id} card={c} first={i === 0} tone={HERO_TONE[c.tone ?? (i % 2 ? "blush" : "pink")]} />)}
    </section>
  );
}

/** Bars that rise from short to tall, each a link to listings of those lengths. Light to dark, as designed. */
const BAR = [
  "bg-pink-150 text-ink",
  "bg-pink-250 text-ink",
  "bg-pink-450 text-ink",
  "bg-primary text-on-primary",
  "bg-surface-inverse text-on-inverse",
];

function LengthBars({ section }: { section: Extract<HomeSection, { type: "length" }> }) {
  const last = Math.max(section.items.length - 1, 1);
  return (
    <section aria-label={section.title} className="flex flex-col gap-3">
      <h2 className="font-display text-heading-md font-extrabold tracking-[-0.5px]">{section.title}</h2>
      <ul className="flex h-[150px] items-end gap-2">
        {section.items.map((item, i) => (
          <li key={item.label} className="flex-1">
            <Link
              href={`/shop?length=${item.lengths.join(",")}`}
              style={{ height: 62 + Math.round((i / last) * 88) }}
              className={cn("flex flex-col items-center justify-end rounded-b-xs rounded-t-md pb-2 text-center text-body-sm font-bold leading-[1.1]", BAR[Math.min(Math.round((i / last) * (BAR.length - 1)), BAR.length - 1)])}
            >
              {item.label}&quot;
              <span className="text-micro font-medium">{item.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tiles({ items }: { items: Extract<HomeSection, { type: "tiles" }>["items"] }) {
  return (
    <section aria-label="Shop by category" className="grid grid-cols-2 gap-2.5">
      {items.map((t, i) => {
        const href = safePath(t.linkUrl);
        if (!href) return null;
        const tone = TILE_TONE[t.tone ?? DEFAULT_TILES[i % DEFAULT_TILES.length]!];
        return (
          <Link key={t.id} href={href} className={cn("relative flex flex-col justify-end overflow-hidden rounded-card p-4", tone.card, i === 0 ? "row-span-2 min-h-[250px]" : "min-h-[120px]")}>
            {t.imageUrl ? <Media image={{ url: t.imageUrl }} alt={t.imageAlt ?? ""} aspect="auto" sizes="50vw" className="absolute inset-0 !h-full rounded-none opacity-50" /> : null}
            <span className={cn("relative font-display font-extrabold leading-none", i === 0 ? "text-heading-sm" : "text-heading-xs")}>{t.title}</span>
            {t.subtitle ? <span className={cn("relative text-caption", tone.sub)}>{t.subtitle}</span> : null}
          </Link>
        );
      })}
    </section>
  );
}

function Trust({ items }: { items: Extract<HomeSection, { type: "trust" }>["items"] }) {
  return (
    <section aria-label="Why shop with us" className="grid grid-cols-2 gap-4 rounded-card bg-surface-tint p-[18px]">
      {items.map((t) => {
        const Icon = ICONS[t.icon] ?? BadgeCheck;
        return (
          <div key={t.title} className="flex items-start gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface text-primary"><Icon aria-hidden="true" size={18} strokeWidth={1.9} /></span>
            <div className="leading-[1.3]"><p className="text-body-sm font-bold">{t.title}</p><p className="text-caption text-muted">{t.caption}</p></div>
          </div>
        );
      })}
    </section>
  );
}

/** Renders the admin-managed list of home sections in order. Types this storefront does not know yet are skipped. */
/** `now` is passed in (epoch ms) so expired cards and deals are dropped on the server, deterministically. */
export function HomeSections({ sections, now }: { sections: HomeSection[]; now: number }) {
  return (
    <>
      {sections.map((section, i) => {
        switch (section.type) {
          case "stories":
            return section.items.length ? <Stories key={i} items={section.items} /> : null;
          case "hero":
            return <Hero key={i} cards={section.cards} now={now} />;
          case "flash":
            return Date.parse(section.endsAt) <= now ? null : <FlashStrip key={i} headline={section.headline} code={section.code} endsAt={section.endsAt} />;
          case "products":
            return section.tabs.some((t) => t.products.length) ? (
              <Section key={i} title={section.title} href="/shop">
                <PicksTabs tabs={section.tabs} />
              </Section>
            ) : null;
          case "length":
            return section.items.length ? <LengthBars key={i} section={section} /> : null;
          case "tiles":
            return section.items.length ? <Tiles key={i} items={section.items} /> : null;
          case "trust":
            return section.items.length ? <Trust key={i} items={section.items} /> : null;
          default:
            return null;
        }
      })}
    </>
  );
}
