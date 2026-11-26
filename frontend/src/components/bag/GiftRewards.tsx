"use client";

import { Check, ChevronDown, Clock, Gift, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button, Media } from "@/components/ui";
import type { GiftOffer } from "@/lib/api/types";
import { giftAction, giftHeadline, giftLink, giftUrgency, liveOffers, signInLink } from "@/lib/cart/gifts";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";

const TICK_MS = 30_000;

type Props = {
  offers: GiftOffer[] | undefined;
  busy: boolean;
  /** Where signing in brings the shopper back to. */
  returnTo: "/bag" | "/checkout";
  /** A reassurance under the button that leaves the page, e.g. that checkout details are kept. */
  leaveNote?: string;
};

/**
 * The free gifts this order has earned and could still earn. Earned ones are confirmed, the nearest one to earn is
 * spelled out with its progress and the way to get it, and any others wait behind "more", so the card stays small
 * enough never to bury the checkout.
 */
export function GiftRewards({ offers, busy, returnTo, leaveNote }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const moreId = useId();

  const live = liveOffers(offers ?? [], now);
  if (live.length === 0) return null;
  const earned = live.filter((o) => o.status === "unlocked");
  const [next, ...others] = live.filter((o) => o.status === "locked");
  const { title, note } = giftHeadline(live);

  return (
    <section aria-labelledby={titleId} aria-busy={busy} className={cn("flex flex-col gap-3 rounded-card border-[1.5px] p-3.5", next ? "border-line-accent bg-surface-blush" : "border-success/30 bg-success-bg")}>
      <div className="flex items-center gap-3">
        {/* Keyed by the number earned, so the badge pops each time another gift is unlocked. */}
        <span key={earned.length} aria-hidden="true" className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full", next ? "bg-primary text-on-primary" : "bg-success text-on-primary", earned.length > 0 && "animate-gift-pop")}>
          <Gift size={20} strokeWidth={2} />
        </span>
        {/* Announced when it changes, so a shopper who cannot see the bar hears that they got closer. */}
        <div role="status" className={cn("flex min-w-0 flex-col leading-[1.3] transition-opacity", busy && "opacity-50")}>
          <h2 id={titleId} className="font-display text-body-lg font-extrabold">{title}</h2>
          <p className="text-caption text-ink-soft">{note}</p>
        </div>
      </div>

      <ul className={cn("flex flex-col gap-2 transition-opacity", busy && "opacity-50")}>
        {earned.map((o) => <Earned key={o.promotionId} offer={o} />)}
        {next ? <Locked offer={next} now={now} returnTo={returnTo} leaveNote={leaveNote} primary /> : null}
      </ul>

      {others.length ? (
        <>
          <ul id={moreId} hidden={!open} className={cn("flex-col gap-2", open && "flex")}>
            {others.map((o) => <Locked key={o.promotionId} offer={o} now={now} returnTo={returnTo} />)}
          </ul>
          <button type="button" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen((v) => !v)} className="inline-flex h-9 items-center gap-1 self-center rounded-pill px-3 text-label font-bold text-primary-strong hover:bg-surface">
            {open ? "Show fewer gifts" : `See ${others.length} more ${others.length === 1 ? "gift" : "gifts"}`}
            <ChevronDown aria-hidden="true" size={16} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        </>
      ) : null}
    </section>
  );
}

function giftName({ gift }: GiftOffer) {
  return `${gift.quantity > 1 ? `${gift.quantity} × ` : ""}${gift.title}`;
}

function Earned({ offer }: { offer: GiftOffer }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-surface p-2.5">
      <Media image={offer.gift.image} alt="" aspect="1 / 1" sizes="44px" className="w-11 shrink-0 rounded-sm" />
      <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
        <span className="line-clamp-2 text-body-sm font-bold">{giftName(offer)}</span>
        <span className="text-caption text-muted">{[offer.gift.optionSummary, `Worth ${formatNaira(offer.gift.valueMinor)}`].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-success-bg px-2.5 py-1 text-micro font-extrabold uppercase text-success">
        <Check aria-hidden="true" size={12} strokeWidth={3} /> Unlocked
      </span>
    </li>
  );
}

function Locked({ offer, now, returnTo, leaveNote, primary = false }: { offer: GiftOffer; now: number; returnTo: Props["returnTo"]; leaveNote?: string | undefined; primary?: boolean }) {
  const { gift, needs, minimumSubtotalMinor: minimum } = offer;
  const link = giftLink(offer, returnTo);
  const signIn = signInLink(returnTo);
  const urgency = giftUrgency(offer, now);
  // A bar only when money is what is missing: it shows how far the covered items have already come.
  const progress = minimum && needs.spendMinor > 0 ? Math.min(offer.eligibleSubtotalMinor, minimum) : null;
  const alsoSignIn = needs.signIn && link.href !== signIn.href;
  // The headline already says "you're ₦X away" for the first gift when any item counts: don't say it twice.
  const saidAbove = primary && needs.spendMinor > 0 && !needs.qualifyingItem && offer.qualifying.allProducts;
  return (
    <li className="flex flex-col gap-2.5 rounded-lg bg-surface p-3">
      <div className="flex gap-3">
        <div className="relative w-14 shrink-0 self-start">
          <Media image={gift.image} alt="" aspect="1 / 1" sizes="56px" className="rounded-sm" />
          <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-surface-inverse text-on-inverse"><Lock size={12} strokeWidth={2.5} /></span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.3]">
          <h3 className="line-clamp-2 text-body-sm font-bold">{giftName(offer)}</h3>
          <p className="flex flex-wrap items-center gap-1.5 text-caption text-muted">
            <s><span className="sr-only">Worth </span>{formatNaira(gift.valueMinor)}</s>
            <span className="rounded-pill bg-primary px-2 py-0.5 text-micro font-extrabold uppercase text-on-primary">Free</span>
            {gift.optionSummary ? <span>{gift.optionSummary}</span> : null}
          </p>
          {urgency.length ? (
            <ul aria-label="Hurry" className="mt-1 flex flex-wrap gap-1.5">
              {urgency.map((u) => <li key={u} className="inline-flex items-center gap-1 rounded-pill bg-warning-bg px-2 py-0.5 text-micro font-bold text-warning"><Clock aria-hidden="true" size={11} strokeWidth={2.5} />{u}</li>)}
            </ul>
          ) : null}
        </div>
      </div>

      {progress !== null ? (
        <div className="flex flex-col gap-1">
          <div role="progressbar" aria-label={`Progress to ${gift.title}`} aria-valuemin={0} aria-valuemax={minimum!} aria-valuenow={progress} aria-valuetext={`${formatNaira(progress)} of ${formatNaira(minimum!)}`} className="h-2.5 overflow-hidden rounded-pill bg-surface-blush">
            <div className="h-full rounded-pill bg-primary transition-[width] duration-500 ease-standard" style={{ width: `${(progress / minimum!) * 100}%` }} />
          </div>
          <p aria-hidden="true" className="text-right text-micro font-bold text-muted">{formatNaira(progress)} of {formatNaira(minimum!)}</p>
        </div>
      ) : null}

      {saidAbove ? null : <p className="text-body-sm font-bold">{giftAction(offer)}</p>}
      {offer.firstOrderOnly || alsoSignIn ? (
        <p className="text-caption text-muted">
          {offer.firstOrderOnly ? "For first orders only. " : ""}
          {alsoSignIn ? <>You’ll also need to <Link href={signIn.href} className="font-semibold text-primary-strong underline">sign in</Link>.</> : null}
        </p>
      ) : null}
      {/* Never the page's loudest button: paying stays the main thing to do. */}
      <Button href={link.href} variant="soft" size="md" fullWidth>{link.label}</Button>
      {leaveNote && link.href !== signIn.href ? <p className="-mt-1 text-center text-caption text-muted">{leaveNote}</p> : null}
    </li>
  );
}
