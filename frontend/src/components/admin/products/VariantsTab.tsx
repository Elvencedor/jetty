"use client";

import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { addOption, isChanged, MAX_OPTIONS, singleVariant, skuPrefix, updateVariant, type MatrixDraft } from "@/lib/admin/matrix";
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
 * up as a draft and are saved together with the header's Save button; stock changes on a saved variant are written to
 * the stock ledger as you make them.
 */
export function VariantsTab({ title, matrix, baseline, disabled, onMatrix, onBaseline }: Props) {
  const [editing, setEditing] = useState<{ option: string; key: string } | null>(null);
  const [addingOption, setAddingOption] = useState(false);
  const skuBase = skuPrefix(matrix, title);
  const changed = isChanged(baseline, matrix);

  if (matrix.variants.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <EmptyState title="No variants yet">A product needs a price and a SKU before it can be published. Set them here, then add options like length and lace.</EmptyState>
        {!disabled ? <FirstVariant title={title} onCreate={(sku, price, stock) => onMatrix(singleVariant(sku, price, stock))} /> : null}
      </div>
    );
  }

  const noOptions = matrix.options.length === 0;
  return (
    <div className="flex flex-col gap-4 p-4">
      {changed ? <p role="status" className="rounded-md bg-info-bg px-3 py-2 text-label font-semibold text-info">You have changes to options or variants. Press Save to apply them.</p> : null}

      {noOptions ? (
        <SingleVariantForm variant={matrix.variants[0]!} disabled={disabled} onPrice={(p) => { const r = updateVariant(matrix, 0, { priceMinor: p }); if (r.ok) onMatrix(r.draft); }} onSku={(s) => { const r = updateVariant(matrix, 0, { sku: s }); if (r.ok) onMatrix(r.draft); return r.ok ? null : r.reason; }} />
      ) : (
        <>
          <div className="flex items-baseline justify-between"><h3 className="font-display text-body-lg font-extrabold">Options</h3><span className="text-caption text-muted">Tap a value to edit it</span></div>
          {matrix.options.map((option, i) => (
            <OptionCard key={option.name} option={option} first={i === 0} draft={matrix} skuBase={skuBase} disabled={disabled} editing={editing?.option === option.name ? editing.key : null} onEdit={(key) => setEditing(key === null ? null : { option: option.name, key })} onChange={onMatrix} />
          ))}
        </>
      )}

      {!disabled && matrix.options.length < MAX_OPTIONS ? (
        addingOption ? (
          <NewOption onCancel={() => setAddingOption(false)} onAdd={(name, first) => { const r = addOption(matrix, name, { label: first }); if (r.ok) { onMatrix(r.draft); setAddingOption(false); } return r.ok ? null : r.reason; }} />
        ) : (
          <button type="button" onClick={() => setAddingOption(true)} className="min-h-11 rounded-md border-[1.5px] border-dashed border-line-accent font-bold text-primary-strong">+ Add another option (e.g. Parting, Hair origin)</button>
        )
      ) : null}

      {!noOptions ? <VariantList draft={matrix} disabled={disabled} onChange={onMatrix} onBaseline={onBaseline} /> : null}
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
      <label className="flex flex-col gap-1 text-label font-semibold">Price (₦)<input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      <label className="flex flex-col gap-1 text-label font-semibold">Opening stock<input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      <label className="col-span-2 flex flex-col gap-1 text-label font-semibold">SKU<input value={sku} onChange={(e) => setSku(e.target.value)} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" /></label>
      <Button type="submit" className="col-span-2" disabled={!valid}>Create the variant</Button>
    </form>
  );
}

function SingleVariantForm({ variant, disabled, onPrice, onSku }: { variant: MatrixDraft["variants"][number]; disabled: boolean; onPrice: (kobo: number) => void; onSku: (sku: string) => string | null }) {
  const [price, setPrice] = useState(String(variant.priceMinor / 100));
  const [sku, setSku] = useState(variant.sku);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Price and SKU" className="flex flex-col gap-2.5 rounded-lg bg-surface-tint p-3.5">
      <h3 className="font-extrabold">Price and SKU</h3>
      <p className="text-caption text-muted">This product has one version. Add an option below if it comes in lengths, colours or sizes.</p>
      <label className="flex flex-col gap-1 text-label font-semibold">Price (₦)
        <input inputMode="numeric" value={price} disabled={disabled} onChange={(e) => setPrice(e.target.value)} onBlur={() => { const k = parseNairaDifference(price); if (k !== null && k > 0) onPrice(k); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-label font-semibold">SKU
        <input value={sku} disabled={disabled} onChange={(e) => { setSku(e.target.value); setError(null); }} onBlur={() => setError(sku === variant.sku ? null : onSku(sku))} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      {error ? <p role="alert" className="text-label font-semibold text-danger">{error}</p> : null}
      <p className="text-caption text-muted">Stock is under Variants once the product has options, or adjust it from Inventory.</p>
    </section>
  );
}

function NewOption({ onAdd, onCancel }: { onAdd: (name: string, firstValue: string) => string | null; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="flex flex-col gap-2.5 rounded-md bg-surface-tint p-3.5" onSubmit={(e) => { e.preventDefault(); setError(onAdd(name, first)); }}>
      <p className="font-extrabold">New option</p>
      <label className="flex flex-col gap-1 text-label font-semibold">Option name<input autoFocus value={name} placeholder="e.g. Parting" onChange={(e) => { setName(e.target.value); setError(null); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3.5 font-normal" /></label>
      <label className="flex flex-col gap-1 text-label font-semibold">First value<input value={first} placeholder="e.g. Middle" onChange={(e) => { setFirst(e.target.value); setError(null); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-3.5 font-normal" /></label>
      <p className="text-caption text-muted">Every variant you have now gets this value, so nothing changes yet. Add more values after.</p>
      {error ? <p role="alert" className="text-label font-semibold text-danger">{error}</p> : null}
      <div className="flex gap-2"><Button type="submit" disabled={!name.trim() || !first.trim()}>Add option</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
