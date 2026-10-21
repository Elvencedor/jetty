"use client";

import { X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import type { Quote } from "@/lib/api/types";
import { rejectionMessage } from "@/lib/cart/model";
import { API_MAX_CODES, normaliseCode, useCartStore } from "@/lib/stores/cart";

/** Promotion codes: the box, the codes that applied (removable), and why any that did not apply were turned down. */
export function CodeEntry({ quote }: { quote: Quote | undefined }) {
  const codes = useCartStore((s) => s.promotionCodes);
  const addCode = useCartStore((s) => s.addCode);
  const removeCode = useCartStore((s) => s.removeCode);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const rejected = new Map(quote?.promotions.rejectedCodes.map((r) => [r.code.toUpperCase(), r.reason]));
  const applied = new Set(quote?.promotions.applied.flatMap((p) => (p.code ? [p.code.toUpperCase()] : [])));

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = normaliseCode(text);
    if (!code) return;
    if (codes.includes(code)) setNote("You've already added that code.");
    else if (codes.length >= API_MAX_CODES) setNote(`You can use up to ${API_MAX_CODES} codes.`);
    else {
      addCode(code);
      setNote(null);
      setText("");
    }
  }

  return (
    <section aria-labelledby="codes-heading" className="flex flex-col gap-2.5">
      <h2 id="codes-heading" className="font-display text-heading-xs font-extrabold">Promo code</h2>
      <form onSubmit={submit} className="flex gap-2">
        <input
          aria-label="Promotion code"
          value={text}
          onChange={(e) => { setText(e.target.value.toUpperCase()); setNote(null); }}
          maxLength={64}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="Have a code?"
          className="h-12 min-w-0 flex-1 rounded-pill border-[1.5px] border-line-strong bg-surface px-4 uppercase placeholder:normal-case"
        />
        <Button type="submit" variant="dark" className="h-12 px-[18px]" disabled={!text.trim()}>Apply</Button>
      </form>
      {note ? <p role="alert" className="text-caption font-semibold text-danger">{note}</p> : null}
      {codes.length ? (
        <ul className="flex flex-col gap-2">
          {codes.map((code) => {
            const reason = rejected.get(code);
            const ok = applied.has(code);
            return (
              <li key={code} className="flex items-start justify-between gap-2 rounded-lg bg-surface px-3.5 py-2">
                <div className="min-w-0">
                  <p className="text-body-sm font-bold">{code}{ok ? <span className="ml-2 text-caption font-semibold text-success">Applied</span> : null}</p>
                  {reason ? <p role="alert" className="text-caption text-danger">{rejectionMessage(reason)}</p> : null}
                </div>
                <button type="button" aria-label={`Remove code ${code}`} onClick={() => removeCode(code)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-blush">
                  <X aria-hidden="true" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
