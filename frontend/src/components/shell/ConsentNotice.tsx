"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import { resetAnalyticsQueue } from "@/lib/analytics";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { useConsent } from "@/lib/stores/consent";

/**
 * A short, in-page notice asking whether anonymous usage analytics may be recorded. It never covers the page and
 * never blocks it: it sits in the flow at the end of the content (appearing there never moves anything already on
 * screen), shows both answers with equal weight, and goes away once one is chosen. Nothing is recorded until "Allow"
 * is pressed, and the footer's "Privacy choices" brings it back.
 */
export function ConsentNotice() {
  const hydrated = useStoreHydrated(useConsent);
  const analytics = useConsent((s) => s.analytics);
  const choose = useConsent((s) => s.choose);
  if (!hydrated || analytics !== "unset") return null;
  return (
    <section aria-label="Privacy choice" className="mt-8 bg-surface-tint px-4 py-3">
      <div className="mx-auto flex max-w-store flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-label text-ink-soft">
          We keep your bag on this device so the shop works. May we also count visits, anonymously, to improve it? See our{" "}
          <Link href="/pages/privacy" className="font-semibold text-primary-strong underline">privacy policy</Link>.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="dark" onClick={() => choose("granted")}>Allow</Button>
          <Button size="sm" variant="outline" onClick={() => { resetAnalyticsQueue(); choose("denied"); }}>No thanks</Button>
        </div>
      </div>
    </section>
  );
}
