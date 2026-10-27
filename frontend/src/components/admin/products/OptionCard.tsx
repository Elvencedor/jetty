"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Switch } from "@/components/ui";
import { addValue, basePrice, deleteValue, editValue, unitsWith, variantsCreatedByAdding, variantsWith, type MatrixDraft, type OptionDraft, type ValueDraft } from "@/lib/admin/matrix";
import { cn } from "@/lib/cn";
import { formatNaira, formatNairaK } from "@/lib/format";

const SWATCHES = ["#1E1612", "#3B2A20", "#5A3A28", "#8A5A3B", "#C08A4A", "#6B1F2A", "#D61F69", "#9AA0A6"];
const EXAMPLES: Record<string, string> = { length: 'e.g. 32"', lace: "e.g. Full lace 360", density: "e.g. 300%", colour: "e.g. Honey blonde 27", color: "e.g. Honey blonde 27", "cap size": "e.g. XL" };

const isColour = (name: string) => /^colou?r$/i.test(name.trim());
const single = (name: string) => name.trim().toLowerCase();

/** "+₦25k", "−₦20k"; the first option shows the absolute price of the value ("₦185k"). */
function deltaLabel(value: ValueDraft, first: boolean, base: number) {
  if (value.deltaMinor === 0) return null;
  return first ? formatNairaK(base + value.deltaMinor) : `${value.deltaMinor < 0 ? "−" : "+"}${formatNairaK(Math.abs(value.deltaMinor))}`;
}

/** Whole naira typed as "25000", "+25000" or "-10000", as kobo; null if it isn't a number. */
export function parseNairaDifference(text: string): number | null {
  const cleaned = text.replace(/[\s,₦]/g, "");
  if (cleaned === "" || cleaned === "+" || cleaned === "-") return 0;
  return /^[+-]?\d{1,9}$/.test(cleaned) ? Number(cleaned) * 100 : null;
}

type Props = {
  option: OptionDraft;
  first: boolean;
  draft: MatrixDraft;
  skuBase: string;
  disabled: boolean;
  /** Which value is being edited: its key, "" for a new one, or null for none. */
  editing: string | null;
  onEdit: (key: string | null) => void;
  onChange: (next: MatrixDraft) => void;
};

/** One option (Length, Lace…): its values as chips that scale to any count, "+ Add", and the inline editor. */
export function OptionCard({ option, first, draft, skuBase, disabled, editing, onEdit, onChange }: Props) {
  const base = basePrice(draft);
  const hint = first ? "sets the base price" : isColour(option.name) ? "shown as swatches" : `price difference per ${single(option.name)}`;
  return (
    <section aria-label={option.name} className={cn("flex flex-col gap-2.5 rounded-[18px] border-[1.5px] bg-surface p-3", editing !== null ? "border-primary" : "border-line")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col leading-[1.25]"><h3 className="font-extrabold">{option.name}</h3><span className="text-caption text-muted">{option.values.length} {option.values.length === 1 ? "value" : "values"} · {hint}</span></div>
        {!disabled ? <button type="button" onClick={() => onEdit("")} className="h-9 shrink-0 rounded-pill border-[1.5px] border-dashed border-line-accent bg-surface-subtle px-3 text-label font-bold text-primary-strong">+ Add {single(option.name)}</button> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {option.values.map((v) => {
          const delta = deltaLabel(v, first, base);
          const on = editing === v.key;
          return (
            <button key={v.key} type="button" disabled={disabled} aria-pressed={on} aria-label={`Edit ${v.label}`} onClick={() => onEdit(on ? null : v.key)} className={cn("flex min-h-9 items-center gap-1.5 rounded-pill border-[1.5px] px-3 text-label font-semibold", on ? "border-primary bg-surface-tint" : "border-line-strong bg-surface", !v.active && "opacity-55")}>
              {v.swatch ? <span aria-hidden="true" className="size-3.5 rounded-full border border-black/15" style={{ background: v.swatch }} /> : null}
              {v.label}
              {delta ? <span className={cn("text-micro font-bold", v.deltaMinor < 0 ? "text-success" : "text-primary-strong")}>{delta}</span> : null}
              {!v.active ? <span className="text-micro text-muted">· hidden</span> : null}
            </button>
          );
        })}
      </div>
      {editing !== null ? (
        <ValueEditor key={`${option.name}:${editing}`} option={option} first={first} draft={draft} skuBase={skuBase} valueKey={editing} base={base} onClose={() => onEdit(null)} onChange={onChange} />
      ) : null}
    </section>
  );
}

type EditorProps = { option: OptionDraft; first: boolean; draft: MatrixDraft; skuBase: string; valueKey: string; base: number; onClose: () => void; onChange: (next: MatrixDraft) => void };

function ValueEditor({ option, first, draft, skuBase, valueKey, base, onClose, onChange }: EditorProps) {
  const existing = option.values.find((v) => v.key === valueKey);
  const isNew = !existing;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [difference, setDifference] = useState(existing ? String(existing.deltaMinor / 100) : "0");
  const [swatch, setSwatch] = useState(existing?.swatch ?? SWATCHES[0]!);
  const [visible, setVisible] = useState(existing?.active ?? true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const region = useRef<HTMLDivElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const kind = single(option.name);

  // The editor takes focus when it opens, and the deletion warning hands it to the safest answer.
  useEffect(() => region.current?.focus(), []);
  useEffect(() => { if (confirming) hideRef.current?.focus(); }, [confirming]);

  const deltaMinor = parseNairaDifference(difference);
  const colour = isColour(option.name);
  const created = isNew ? variantsCreatedByAdding(draft, option.name) : 0;
  const used = existing ? variantsWith(draft, option.name, valueKey).length : 0;
  const units = existing ? unitsWith(draft, option.name, valueKey) : 0;
  const repricedBy = existing && deltaMinor !== null && deltaMinor !== existing.deltaMinor ? deltaMinor - existing.deltaMinor : 0;

  function save() {
    if (deltaMinor === null) return setError("Enter the difference in naira, for example 25000 or -10000.");
    const result = isNew
      ? addValue(draft, option.name, { label, deltaMinor, swatch: colour ? swatch : null }, skuBase)
      : editValue(draft, option.name, valueKey, { label, deltaMinor, swatch: colour ? swatch : null, active: visible });
    if (!result.ok) return setError(result.reason);
    onChange(result.draft);
    onClose();
  }
  function remove() {
    const result = deleteValue(draft, option.name, valueKey);
    if (!result.ok) {
      setConfirming(false);
      return setError(result.reason);
    }
    onChange(result.draft);
    onClose();
  }
  function hide() {
    const result = editValue(draft, option.name, valueKey, { active: false });
    if (result.ok) onChange(result.draft);
    onClose();
  }

  return (
    <div ref={region} tabIndex={-1} role="group" aria-label={isNew ? `New ${kind}` : `Edit ${kind}: ${existing.label}`} className="flex flex-col gap-2.5 rounded-md bg-surface-tint p-3.5 outline-none">
      <p className="font-extrabold">{isNew ? `New ${kind}` : `Edit ${kind}: ${existing.label}`}</p>
      <label className="flex flex-col gap-1 text-label font-semibold">
        Name customers see
        <input value={label} onChange={(e) => { setLabel(e.target.value); setError(undefined); }} placeholder={EXAMPLES[kind] ?? "e.g. …"} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3.5 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-label font-semibold">
        Price difference (₦)
        <span className="flex h-11 items-center overflow-hidden rounded-md border-[1.5px] border-line-strong bg-surface"><span aria-hidden="true" className="pl-3.5 pr-2.5 font-bold text-muted">±</span><input value={difference} onChange={(e) => { setDifference(e.target.value); setError(undefined); }} inputMode="numeric" className="h-full min-w-0 flex-1 border-0 font-normal outline-none" /></span>
        <span className="text-caption font-normal text-muted">
          {first ? `Added to the ${formatNaira(base)} base. This ${kind} would cost ${formatNaira(base + (deltaMinor ?? 0))} before other options.` : `Added to every variant with this ${kind}. Use a minus for cheaper, e.g. -10000.`}
        </span>
      </label>
      {colour ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-label font-semibold">Swatch colour</span>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((hex) => (
              <button key={hex} type="button" aria-label={`Swatch ${hex}`} aria-pressed={swatch === hex} onClick={() => setSwatch(hex)} className={cn("size-9 rounded-full border-[3px] shadow-swatch-inset", swatch === hex ? "border-primary" : "border-line")} style={{ background: hex }} />
            ))}
          </div>
        </div>
      ) : null}
      {existing ? (
        <div className="flex min-h-10 items-center justify-between gap-2.5">
          <span className="flex flex-col leading-[1.3]"><span className="font-semibold">Show in store</span><span className="text-caption text-muted">Turn off to stop selling it without deleting anything</span></span>
          <Switch label="Show in store" checked={visible} onChange={setVisible} />
        </div>
      ) : null}
      <p className="flex gap-2 rounded-sm bg-surface p-2.5 text-label text-ink-soft">
        <span aria-hidden="true" className="mt-0.5 text-primary">ⓘ</span>
        <span>
          {isNew
            ? `Creates ${created} new ${created === 1 ? "variant" : "variants"}, one for every mix of the other options. They start at 0 stock, so customers won’t see them until you add stock below.`
            : `Used by ${used} ${used === 1 ? "variant" : "variants"} with ${units} units in stock. Renaming updates the store straight away; past orders keep the old name.${repricedBy ? ` Changing the price difference reprices them by ${repricedBy < 0 ? "−" : "+"}${formatNaira(Math.abs(repricedBy))} each.` : ""}`}
        </span>
      </p>
      {error ? <p role="alert" className="text-label font-semibold text-danger">{error}</p> : null}
      {confirming && existing ? (
        <div role="alert" className="flex flex-col gap-2 rounded-sm bg-danger-bg p-3 text-label text-danger">
          <strong>Delete “{existing.label}”?</strong>
          <span>This removes {used} {used === 1 ? "variant" : "variants"} and {units} units of stock. Past orders keep their details. Shoppers with it in their bag will be asked to choose again.</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger-soft" className="border border-danger" onClick={remove}>Yes, delete</Button>
            <Button ref={hideRef} size="sm" variant="outline" onClick={hide}>Hide it instead</Button>
            <Button size="sm" variant="ghost-link" onClick={() => setConfirming(false)}>Keep it</Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!label.trim()} onClick={save}>{isNew ? `Add ${kind}` : "Save changes"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <span className="flex-1" />
        {existing ? <button type="button" onClick={() => setConfirming(true)} className="h-10 rounded-pill px-3 font-bold text-danger">Delete</button> : null}
      </div>
    </div>
  );
}
