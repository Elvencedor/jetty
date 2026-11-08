"use client";

import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Segmented } from "@/components/ui";
import { addOptionWithValues, isChanged, MAX_OPTIONS, MAX_VARIANTS, singleVariant, skuPrefix, updateVariant, type MatrixDraft } from "@/lib/admin/matrix";
import { minorToAmountText, onAmountChange } from "@/lib/admin/amount";
import { OPTION_PRESETS, splitValues } from "@/lib/admin/option-presets";
import { cn } from "@/lib/cn";
import { OptionCard, parseNairaDifference } from "./OptionCard";
import { VariantList } from "./VariantList";

type Props = {
  productId: string;
  title: string;
  slug: string;
  matrix: MatrixDraft;
  baseline: MatrixDraft;
  disabled: boolean;
  onMatrix: (next: MatrixDraft | ((current: MatrixDraft) => MatrixDraft)) => void;
  onBaseline: (next: MatrixDraft | ((current: MatrixDraft) => MatrixDraft)) => void;
};

/**
 * The product's options and variants. Changes to options (adding, renaming, repricing, hiding, deleting values) build
 * up as a draft and are saved together with the Save button; stock changes on a saved variant are written to
 * the stock ledger as you make them.
 */
export function VariantsTab({ title, matrix, baseline, disabled, onMatrix, onBaseline }: Props) {
  const [editing, setEditing] = useState<{ option: string; key: string } | null>(null);
  const [addingOption, setAddingOption] = useState(false);
  // Below the large breakpoint there is room for one of the two at a time: this chooses which.
  const [view, setView] = useState<"options" | "variants">("variants");
  const skuBase = skuPrefix(matrix, title);
  const changed = isChanged(baseline, matrix);

  if (matrix.variants.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <EmptyState title="No variants yet">A product needs a price and a SKU before it can be published. Set them here, then add options like length and lace.</EmptyState>
        {!disabled ? <FirstVariant title={title} onCreate={(sku, price, stock) => onMatrix(singleVariant(sku, price, stock))} /> : null}
      </div>
    );
  }

  const noOptions = matrix.options.length === 0;
  const banner = changed ? <p role="status" className="rounded-md bg-info-bg px-3 py-2 text-label font-semibold text-info">You have changes to options or variants. Press Save to apply them.</p> : null;

  const addOptionControl =
    !disabled && matrix.options.length < MAX_OPTIONS ? (
      addingOption ? (
        <NewOption draft={matrix} noOptions={noOptions} onCancel={() => setAddingOption(false)} onAdd={(name, values) => { const r = addOptionWithValues(matrix, name, values, skuBase); if (r.ok) { onMatrix(r.draft); setAddingOption(false); } return r.ok ? null : r.reason; }} />
      ) : (
        <button type="button" onClick={() => setAddingOption(true)} className="min-h-11 rounded-md border-[1.5px] border-dashed border-line-accent font-bold text-primary-strong">{noOptions ? "+ Add options like Length or Colour" : "+ Add another option"}</button>
      )
    ) : null;

  // No options yet: one calm column that explains what they are.
  if (noOptions) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
        {banner}
        <OptionsGuide />
        {addOptionControl}
        <SingleVariantForm variant={matrix.variants[0]!} disabled={disabled} onPrice={(p) => { const r = updateVariant(matrix, 0, { priceMinor: p }); if (r.ok) onMatrix(r.draft); }} onSku={(s) => { const r = updateVariant(matrix, 0, { sku: s }); if (r.ok) onMatrix(r.draft); return r.ok ? null : r.reason; }} />
      </div>
    );
  }

  // With options: what shoppers choose on the left, and the variants those choices make on the right, side by side so
  // neither pushes the other off the screen. On a phone they are two views you switch between, so neither buries the other.
  const optionsView = view === "options";
  return (
    <div className="flex flex-col gap-4 p-4 lg:grid lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="sticky top-0 z-[2] -mx-4 -mt-4 bg-surface px-4 py-2 lg:hidden">
        <Segmented mode="tabs" label="Options or variants" className="flex w-full [&>button]:flex-1 [&>button]:justify-center" items={[{ value: "variants", label: "Stock & prices", count: matrix.variants.length }, { value: "options", label: "Options", count: matrix.options.length }]} value={view} onChange={setView} />
      </div>
      <aside aria-label="Options" className={cn("flex-col gap-3 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-17rem)] lg:overflow-y-auto lg:pr-1", optionsView ? "flex" : "hidden")}>
        <div className="flex items-baseline justify-between"><h3 className="font-display text-body-lg font-extrabold">Options</h3><span className="text-caption text-muted">Tap a value to edit it</span></div>
        <p className="-mt-1.5 text-caption text-muted">An option is something shoppers choose, like Length or Colour. Every mix of values is one variant, where you set its stock and can change its price.</p>
        {addOptionControl}
        {matrix.options.map((option, i) => (
          <OptionCard key={option.name} option={option} first={i === 0} draft={matrix} skuBase={skuBase} disabled={disabled} editing={editing?.option === option.name ? editing.key : null} onEdit={(key) => setEditing(key === null ? null : { option: option.name, key })} onChange={onMatrix} />
        ))}
        {optionsView ? <p className="text-caption text-muted lg:hidden">Done here? <button type="button" onClick={() => setView("variants")} className="font-bold text-primary-strong underline">See the {matrix.variants.length} variants</button> to set stock and prices.</p> : null}
      </aside>
      <div className={cn("min-w-0 flex-col gap-3 lg:flex", optionsView ? "hidden" : "flex")}>
        {banner}
        <VariantList draft={matrix} disabled={disabled} onChange={onMatrix} onBaseline={onBaseline} />
      </div>
    </div>
  );
}

function FirstVariant({ title, onCreate }: { title: string; onCreate: (sku: string, priceMinor: number, stock: number) => void }) {
  const [sku, setSku] = useState(skuPrefix({ options: [], variants: [] }, title));
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const kobo = parseNairaDifference(price);
  const units = Number(stock);
  const valid = sku.trim() !== "" && kobo !== null && kobo > 0 && Number.isInteger(units) && units >= 0;
  return (
    <form className="grid grid-cols-2 gap-2.5 rounded-lg bg-surface-tint p-3.5" onSubmit={(e) => { e.preventDefault(); if (valid) onCreate(sku.trim(), kobo!, units); }}>
      <label className="flex flex-col gap-1 text-label font-semibold">Price (₦)<input inputMode="numeric" value={price} onChange={onAmountChange(price, setPrice, { decimal: false })} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      <label className="flex flex-col gap-1 text-label font-semibold">Opening stock<input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      <label className="col-span-2 flex flex-col gap-1 text-label font-semibold">SKU<input value={sku} onChange={(e) => setSku(e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      <Button type="submit" className="col-span-2" disabled={!valid}>Create the variant</Button>
    </form>
  );
}

function SingleVariantForm({ variant, disabled, onPrice, onSku }: { variant: MatrixDraft["variants"][number]; disabled: boolean; onPrice: (kobo: number) => void; onSku: (sku: string) => string | null }) {
  const [price, setPrice] = useState(minorToAmountText(variant.priceMinor));
  const [sku, setSku] = useState(variant.sku);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Price and SKU" className="flex flex-col gap-2.5 rounded-lg bg-surface-tint p-3.5">
      <h3 className="font-extrabold">Price and SKU</h3>
      <p className="text-caption text-muted">This product has one version, so one price and one SKU. If it comes in lengths, colours or sizes, add options below.</p>
      <label className="flex flex-col gap-1 text-label font-semibold">Price (₦)
        <input inputMode="numeric" value={price} disabled={disabled} onChange={onAmountChange(price, setPrice, { decimal: false })} onBlur={() => { const k = parseNairaDifference(price); if (k !== null && k > 0) onPrice(k); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-label font-semibold">SKU
        <input value={sku} disabled={disabled} onChange={(e) => { setSku(e.target.value); setError(null); }} onBlur={() => setError(sku === variant.sku ? null : onSku(sku))} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      {error ? <p role="alert" className="text-label font-semibold text-danger">{error}</p> : null}
      <p className="text-caption text-muted">Stock is under Variants once the product has options, or adjust it from Inventory.</p>
    </section>
  );
}

/** A short explanation of options and variants, with an example, shown until the product has any option. */
function OptionsGuide() {
  return (
    <section aria-label="How options work" className="flex flex-col gap-2.5 rounded-lg border-[1.5px] border-dashed border-line-accent p-3.5">
      <h3 className="font-extrabold">Does this product come in different versions?</h3>
      <p className="text-label text-ink-soft">Use options when shoppers can choose, for example a wig in several lengths or lace types. Each choice is an <strong>option</strong>, and every mix of choices is a <strong>variant</strong> with its own stock and, if you like, its own price.</p>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-label text-ink-soft">
        <li>Add an option, like <strong>Length</strong>, and the values it can take: 12&quot;, 14&quot;, 16&quot;.</li>
        <li>Add a second option if you need one, like <strong>Lace</strong>: Closure, Frontal.</li>
        <li>We create a variant for each mix, 6 in this example. Then set the stock for each.</li>
      </ol>
      <p className="text-caption text-muted">One version only? Skip this and just set the price and SKU below.</p>
    </section>
  );
}

/**
 * Creating an option in one go: choose what shoppers will pick (a common option or your own), then its values (tap the
 * suggestions, type your own, or both). It says how many variants that will create before anything is added.
 */
function NewOption({ draft, noOptions, onAdd, onCancel }: { draft: MatrixDraft; noOptions: boolean; onAdd: (name: string, values: string[]) => string | null; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // Opening the form brings it into view, wherever the list had been scrolled to.
  useEffect(() => {
    form.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const taken = new Set(draft.options.map((o) => o.name.trim().toLowerCase()));
  const preset = OPTION_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const values = [...new Set([...picked, ...splitValues(typed)].map((v) => v.trim()))];
  // The product has one variant per mix of its options (one, if it has none). The first value goes on every one of them;
  // each further value makes another variant for every mix.
  const mixes = Math.max(draft.variants.length, 1);
  const total = values.length * mixes;
  const created = Math.max(values.length - 1, 0) * mixes;
  const tooMany = total > MAX_VARIANTS;

  function choose(preset: string) {
    setName(preset);
    setPicked([]);
    setError(null);
  }
  const toggle = (value: string) => { setPicked((p) => (p.includes(value) ? p.filter((v) => v !== value) : [...p, value])); setError(null); };

  return (
    <form ref={form} className="flex flex-col gap-3 rounded-md bg-surface-tint p-3.5" onSubmit={(e) => { e.preventDefault(); setError(onAdd(name, values)); }}>
      <p className="font-extrabold">{noOptions ? "Add an option" : "Add another option"}</p>
      <p className="text-caption text-muted">An option is something shoppers choose between. Pick a common one, or type your own.</p>

      <div className="flex flex-col gap-1.5">
        <span className="text-label font-semibold">1. What do shoppers choose?</span>
        <div className="flex flex-wrap gap-1.5">
          {OPTION_PRESETS.map((p) => {
            const used = taken.has(p.name.toLowerCase());
            return (
              <button key={p.name} type="button" disabled={used} aria-pressed={preset?.name === p.name} onClick={() => choose(p.name)} title={used ? "Already added" : p.blurb} className={cn("min-h-9 rounded-pill border-[1.5px] px-3 text-label font-semibold disabled:opacity-45", preset?.name === p.name ? "border-primary bg-surface" : "border-line-strong bg-surface")}>
                {p.name}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-1 text-label font-semibold">Or type your own<input value={name} placeholder="e.g. Parting, Hair origin" onChange={(e) => { setName(e.target.value); setPicked([]); setError(null); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3.5 font-normal" /></label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-label font-semibold">2. Which values can they pick?</span>
        {preset ? (
          <div role="group" aria-label={`Suggested ${preset.name.toLowerCase()} values`} className="flex flex-wrap gap-1.5">
            {preset.values.map((v) => (
              <button key={v} type="button" aria-pressed={picked.includes(v)} onClick={() => toggle(v)} className={cn("min-h-9 rounded-pill border-[1.5px] px-3 text-label font-semibold", picked.includes(v) ? "border-primary bg-surface text-primary-strong" : "border-line-strong bg-surface")}>
                {picked.includes(v) ? "✓ " : ""}{v}
              </button>
            ))}
          </div>
        ) : null}
        <label className="flex flex-col gap-1 text-label font-semibold">{preset ? "Add your own" : "Values"}<input value={typed} placeholder={preset ? "Separate with commas" : "e.g. Middle, Side, Free (separate with commas)"} onChange={(e) => { setTyped(e.target.value); setError(null); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3.5 font-normal" /></label>
      </div>

      <p role="status" className={cn("rounded-sm bg-surface p-2.5 text-label", tooMany ? "text-danger" : "text-ink-soft")}>
        {values.length === 0
          ? "Choose or type at least one value."
          : tooMany
            ? `That would make ${total.toLocaleString("en-NG")} variants. One product can have at most ${MAX_VARIANTS.toLocaleString("en-NG")}.`
            : `${values.length} ${values.length === 1 ? "value" : "values"}${mixes > 1 ? ` × ${mixes} current ${mixes === 1 ? "variant" : "variants"}` : ""} = ${total} ${total === 1 ? "variant" : "variants"}${created > 0 ? `, ${created} of them new. New variants start at 0 stock, so customers won't see them until you add stock` : ""}.`}
      </p>
      {error ? <p role="alert" className="text-label font-semibold text-danger">{error}</p> : null}
      <div className="flex gap-2"><Button type="submit" disabled={!name.trim() || values.length === 0 || tooMany}>Add option</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
