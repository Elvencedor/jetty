import type { ChangeEvent } from "react";

type Options = {
  /** Allow kobo after a point (default). Turn off for amounts that are whole naira only. */
  decimal?: boolean;
  /** Allow a leading + or −, for a price difference. */
  signed?: boolean;
};

/**
 * What a person typed into an amount box, tidied as they type: only digits (and one decimal point with up to two places, if
 * allowed), thousands separated by commas. "1500" is "1,500", "₦ 12500.5" is "12,500.5". An optional leading sign is kept
 * for differences. Anything else is dropped, so pasting "₦1,500.50 NGN" works.
 */
export function formatAmountInput(raw: string, { decimal = true, signed = false }: Options = {}): string {
  let sign = "";
  let rest = raw.trim();
  if (signed && /^[+\-−–]/.test(rest)) {
    sign = rest[0] === "+" ? "+" : "-";
    rest = rest.slice(1);
  }
  const point = decimal ? rest.indexOf(".") : -1;
  const whole = (point === -1 ? rest : rest.slice(0, point)).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const fraction = point === -1 ? null : rest.slice(point + 1).replace(/\D/g, "").slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction === null ? "" : `.${fraction}`}`;
}

/** An amount already held in kobo, as the text an amount box shows: 12500050 is "125,000.50", 150000 is "1,500". */
export function minorToAmountText(minor: number): string {
  const naira = Math.floor(Math.abs(minor) / 100);
  const kobo = Math.abs(minor) % 100;
  return `${minor < 0 ? "-" : ""}${formatAmountInput(String(naira), { decimal: false })}${kobo ? `.${String(kobo).padStart(2, "0").replace(/0$/, "")}` : ""}`;
}

/** The characters that count when placing the caret: everything but the commas the formatter adds. */
const significant = (text: string) => text.replace(/,/g, "");

/**
 * An `onChange` for an amount box. It sets the formatted text and puts the caret back where the person was typing, so
 * adding a comma never throws the cursor to the end. Backspacing over a comma removes the digit before it instead of doing
 * nothing. `current` is the text the box showed before this change.
 */
export function onAmountChange(current: string, set: (text: string) => void, options: Options = {}) {
  return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = event.target;
    let raw = input.value;
    let caret = input.selectionStart ?? raw.length;
    // Backspace over a comma changes nothing but the comma, which formatting would put straight back.
    if (significant(raw) === significant(current) && raw.length < current.length && caret > 0) {
      raw = raw.slice(0, caret - 1) + raw.slice(caret);
      caret -= 1;
    }
    const wanted = significant(raw.slice(0, caret)).length;
    const next = formatAmountInput(raw, options);
    set(next);
    // After React has put the new text in the box, move the caret past the same number of digits as before.
    requestAnimationFrame(() => {
      let seen = 0;
      let at = 0;
      while (at < next.length && seen < wanted) {
        if (next[at] !== ",") seen += 1;
        at += 1;
      }
      if (document.activeElement === input) input.setSelectionRange(at, at);
    });
  };
}
