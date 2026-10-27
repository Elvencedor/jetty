"use client";

import { useConsent } from "@/lib/stores/consent";

/** Footer link that brings the privacy choice back, so agreeing is never a one-way door. */
export function PrivacyChoiceButton({ className }: { className?: string }) {
  const reset = useConsent((s) => s.reset);
  return (
    <button type="button" onClick={() => reset()} className={className}>
      Privacy choices
    </button>
  );
}
