import { BadgeCheck, Clock, Lock, RotateCcw, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Media } from "@/components/ui";
import type { HomeSection, Tone } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { FlashStrip } from "./FlashStrip";
import { PicksTabs } from "./PicksTabs";

const TONE: Record<Tone, { card: string; text: string; cta: "primary" | "dark" }> = {
  pink: { card: "bg-primary text-on-primary", text: "text-white", cta: "dark" },
  blush: { card: "bg-surface-blush text-ink", text: "text-ink-soft", cta: "primary" },
  plum: { card: "bg-surface-inverse text-on-inverse", text: "text-on-inverse-muted", cta: "primary" },
  white: { card: "bg-surface text-ink border border-line", text: "text-ink-soft", cta: "primary" },
};

const ICONS: Record<string, LucideIcon> = { lock: Lock, shield: Lock, return: RotateCcw, truck: Truck, delivery: Truck, star: BadgeCheck, check: BadgeCheck, clock: Clock };

/** Only same-site paths from the CMS become links; anything else is dropped rather than trusted. */
const safePath = (url: string | undefined) => (url && /^\/(?!\/)/.test(url) ? url : undefined);

function Section({ title, href, children, label }: { title?: string; href?: string; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={title ? undefined : label} aria-labelledby={undefined} className="flex flex-col gap-3">
      {title ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-heading-md font-extrabold">{title}</h2>
          {href ? <Link href={href} className="text-label font-semibold text-primary-strong">See all</Link> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Stories({ items }: { items: Extract<HomeSection, { type: "stories" }>["items"] }) {
  return (
    <nav aria-label="Highlights">
      <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {items.map((s, i) => {
          const href = safePath(s.linkUrl);
          if (!href) return null;
          return (
            <li key={s.id} className="w-[72px] shrink-0 snap-start">
              <Link href={href} className="flex flex-col items-center gap-1.5">
                <span className={cn("rounded-full border-[3px] p-0.5", s.highlight ? "border-primary" : "border-line-strong")}>
                  <Media image={{ url: s.imageUrl ?? null }} alt="" aspect="1 / 1" tone={i} sizes="72px" className="size-[60px] rounded-full" />
                </span>
                <span className="line-clamp-2 text-center text-caption font-semibold">{s.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Hero({ cards, now }: { cards: Extract<HomeSection, { type: "hero" }>["cards"]; now: number }) {
  const live = cards.filter((c) => !c.endsAt || Date.parse(c.endsAt) > now);
  if (!live.length) return null;
  return (
    <section aria-label="Offers" className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
      {live.map((c, i) => {
        const tone = TONE[c.tone ?? "pink"];
        const href = safePath(c.ctaUrl) ?? "/shop";
        return (
          <article key={c.id} className={cn("relative flex min-h-[380px] w-[320px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-xl p-5 sm:w-[360px] lg:w-auto", tone.card)}>
            {c.imageUrl ? <Media image={{ url: c.imageUrl }} alt={c.imageAlt ?? ""} aspect="auto" priority={i === 0} sizes="(min-width: 1024px) 50vw, 360px" className="absolute inset-0 -z-0 !h-full rounded-none opacity-40" /> : null}
            <div className="relative flex flex-col gap-3">
              {c.tag ? <span className="self-start rounded-pill bg-black/20 px-3 py-1 text-micro font-bold uppercase tracking-[0.06em]">{c.tag}</span> : null}
              <h2 className="line-clamp-3 font-display text-display-lg font-extrabold">{c.headline}</h2>
              {c.subheadline ? <p className={cn("text-body-sm", tone.text)}>{c.subheadline}</p> : null}
            </div>
            {c.ctaLabel ? (
              <Link href={href} className={cn("relative inline-flex h-11 items-center self-start rounded-pill px-5 text-body-sm font-semibold after:absolute after:-inset-[999px] after:content-['']", tone.cta === "dark" ? "bg-surface-inverse text-on-inverse" : "bg-primary text-on-primary")} aria-label={`${c.ctaLabel}: ${c.headline}`}>
                {c.ctaLabel}
              </Link>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

const BAR_TONES = ["bg-surface-blush", "bg-pink-200", "bg-pink-400", "bg-primary", "bg-surface-inverse"];

function LengthBars({ section }: { section: Extract<HomeSection, { type: "length" }> }) {
  return (
    <Section title={section.title}>
      <ul className="flex items-end gap-2">
        {section.items.map((item, i) => {
          const height = 62 + Math.round((i / Math.max(section.items.length - 1, 1)) * 88);
          const dark = i >= 3;
          return (
            <li key={item.label} className="flex-1">
              <Link href={`/shop?length=${item.lengths.join(",")}`} style={{ height }} className={cn("flex flex-col items-center justify-end rounded-lg p-2 text-center", BAR_TONES[Math.min(i, BAR_TONES.length - 1)], dark ? "text-on-primary" : "text-ink")}>
                <span className="text-label font-bold">{item.label}&quot;</span>
                <span className="text-caption">{item.hint}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Tiles({ items }: { items: Extract<HomeSection, { type: "tiles" }>["items"] }) {
  return (
    <section aria-label="Shop by category" className="grid grid-cols-2 gap-3">
      {items.map((t, i) => {
        const href = safePath(t.linkUrl);
        if (!href) return null;
        const tone = TONE[t.tone ?? "blush"];
        return (
          <Link key={t.id} href={href} className={cn("relative flex min-h-36 flex-col justify-end gap-0.5 overflow-hidden rounded-card p-4", tone.card, i === 0 && "row-span-2")}>
            {t.imageUrl ? <Media image={{ url: t.imageUrl }} alt={t.imageAlt ?? ""} aspect="auto" sizes="50vw" className="absolute inset-0 !h-full rounded-none opacity-50" /> : null}
            <span className="relative font-display text-heading-sm font-extrabold">{t.title}</span>
            {t.subtitle ? <span className={cn("relative text-caption", tone.text)}>{t.subtitle}</span> : null}
          </Link>
        );
      })}
    </section>
  );
}

function Trust({ items }: { items: Extract<HomeSection, { type: "trust" }>["items"] }) {
  return (
    <section aria-label="Why shop with us" className="grid grid-cols-2 gap-4 rounded-card bg-surface-tint p-4">
      {items.map((t) => {
        const Icon = ICONS[t.icon] ?? BadgeCheck;
        return (
          <div key={t.title} className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-primary-strong"><Icon aria-hidden="true" size={20} /></span>
            <div><p className="text-body-sm font-bold">{t.title}</p><p className="text-caption text-muted">{t.caption}</p></div>
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
