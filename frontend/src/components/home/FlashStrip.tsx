"use client";

import { Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Countdown } from "./Countdown";

/** Dark strip for a running flash deal. It collapses when the deal ends. */
export function FlashStrip({ headline, code, endsAt }: { headline: string; code: string | null; endsAt: string }) {
  const [ended, setEnded] = useState(false);
  if (ended) return null;
  return (
    <Link href="/shop?onOffer=1" className="flex items-center gap-3 rounded-lg bg-surface-inverse px-4 py-3.5 text-on-inverse">
      <Zap aria-hidden="true" size={26} className="shrink-0 fill-on-inverse-muted text-on-inverse-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{headline}</span>
        <span className="block text-label text-on-inverse-muted">{code ? `Code ${code} · ends in` : "Ends in"}</span>
      </span>
      <Countdown endsAt={endsAt} onEnd={() => setEnded(true)} />
    </Link>
  );
}
