"use client";

import { ChevronDown, ChevronUp, Minus, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Dropdown } from "@/components/ui";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { availableOf, computedPrice, groupVariants, hasCustomPrice, stockLevel, totalUnits, updateVariant, variantName, type MatrixDraft, type StockLevel, type VariantDraft } from "@/lib/admin/matrix";
import { adjustStock } from "@/lib/api/admin-catalog";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";
import { toast } from "@/lib/stores/toast";
import { parseNairaDifference } from "./OptionCard";

const GROUP_PAGE = 20;
/** How long a run of + and − taps waits before it is written to the stock ledger as one adjustment. */
const STOCK_WRITE_DELAY_MS = 700;

const PILL: Record<StockLevel, string> = { out: "bg-danger-bg text-danger", low: "bg-warning-bg text-warning", ok: "bg-success-bg text-success" };

type Props = {
  draft: MatrixDraft;
  disabled: boolean;
  onChange: (next: MatrixDraft | ((current: MatrixDraft) => MatrixDraft)) => void;
  /** What the server has: stock edits are saved straight away, so they change this as well. */
  onBaseline: (next: MatrixDraft | ((current: MatrixDraft) => MatrixDraft)) => void;
};

const keyOf = (v: VariantDraft) => v.id ?? `new:${v.sku}`;

/** Filters, the grouped list of variants, the row editor and the bulk bar. */
export function VariantList({ draft, disabled, onChange, onBaseline }: Props) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [lowOnly, setLowOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(() => draft.options[0]?.values[0]?.key ?? null);
  const [row, setRow] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [bulk, setBulk] = useState<"price" | "stock" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Stock taps waiting to be written, per saved variant.
  const pending = useRef(new Map<string, { delta: number; timer: ReturnType<typeof setTimeout> }>());

  const groups = groupVariants(draft, { values: filters, lowOnly });
  const filterOptions = draft.options.slice(1, 4);
  const active = draft.variants.filter((v) => v.active);

  // Stock is written to the server as you go, so the draft and what the server has move together. These are updaters,
  // applied to the newest state, so a late response never overwrites an edit made while it was on its way.
  const patchStock = (id: string, patch: (v: VariantDraft) => Partial<VariantDraft>) => {
    const apply = (m: MatrixDraft): MatrixDraft => ({ ...m, variants: m.variants.map((v) => (v.id === id ? { ...v, ...patch(v) } : v)) });
    onChange(apply);
    onBaseline(apply);
  };
  const setOnHand = (id: string, onHand: number, threshold?: number | null) => patchStock(id, () => ({ onHand, ...(threshold !== undefined ? { lowStockThreshold: threshold } : {}) }));

  function changeStock(v: VariantDraft, by: number) {
    if (v.onHand + by < v.reserved || v.onHand + by < 0) return;
    const index = draft.variants.indexOf(v);
    if (!v.id) {
      const next = updateVariant(draft, index, { onHand: v.onHand + by });
      if (next.ok) onChange(next.draft);
      return;
    }
    const id = v.id;
    patchStock(id, (x) => ({ onHand: x.onHand + by }));
    const waiting = pending.current.get(id);
    if (waiting) clearTimeout(waiting.timer);
    const delta = (waiting?.delta ?? 0) + by;
    const timer = setTimeout(async () => {
      pending.current.delete(id);
      try {
        const saved = await adjustStock(id, { mode: "adjust", quantity: delta, reason: "correction" });
        setOnHand(id, saved.onHand);
      } catch (err) {
        patchStock(id, (x) => ({ onHand: x.onHand - delta }));
        toast.error(adminErrorMessage(err));
      }
    }, STOCK_WRITE_DELAY_MS);
    pending.current.set(id, { delta, timer });
  }

  async function saveThreshold(v: VariantDraft, text: string) {
    const n = text.trim() === "" ? null : Number(text);
    if (n !== null && (!Number.isInteger(n) || n < 0)) return toast.error("Enter a whole number, or leave it empty.");
    if (n === v.lowStockThreshold) return;
    if (!v.id) {
      const next = updateVariant(draft, draft.variants.indexOf(v), { lowStockThreshold: n });
      if (next.ok) onChange(next.draft);
      return;
    }
    try {
      const saved = await adjustStock(v.id, { mode: "adjust", quantity: 0, reason: "correction", lowStockThreshold: n });
      setOnHand(v.id, saved.onHand, saved.lowStockThreshold);
    } catch (err) {
      toast.error(adminErrorMessage(err));
    }
  }

  function edit(v: VariantDraft, patch: Parameters<typeof updateVariant>[2]) {
    const result = updateVariant(draft, draft.variants.indexOf(v), patch);
    if (!result.ok) return toast.error(result.reason);
    onChange(result.draft);
  }

  async function applyBulk() {
    const chosen = draft.variants.filter((v) => checked.has(keyOf(v)));
    if (bulk === "price") {
      const kobo = parseNairaDifference(bulkValue);
      if (kobo === null || kobo <= 0) return toast.error("Enter a price in naira, for example 185000.");
      onChange({ ...draft, variants: draft.variants.map((v) => (checked.has(keyOf(v)) ? { ...v, priceMinor: kobo } : v)) });
      toast.success(`Price set on ${chosen.length} variants. Press Save to apply it.`);
    } else if (bulk === "stock") {
      const qty = Number(bulkValue);
      if (!Number.isInteger(qty) || qty === 0) return toast.error("Enter how many units to add (a whole number).");
      setBulkBusy(true);
      let failed = 0;
      const saved = chosen.filter((v) => v.id);
      const queue = [...saved];
      // A handful at a time: a long selection should not open hundreds of connections at once.
      await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
        for (let v = queue.shift(); v; v = queue.shift()) {
          try {
            const res = await adjustStock(v.id!, { mode: "adjust", quantity: qty, reason: "restock" });
            setOnHand(v.id!, res.onHand);
          } catch {
            failed++;
          }
        }
      }));
      onChange((fresh) => ({ ...fresh, variants: fresh.variants.map((v) => (!v.id && checked.has(keyOf(v)) ? { ...v, onHand: Math.max(v.onHand + qty, 0) } : v)) }));
      setBulkBusy(false);
      if (failed) toast.error(`${failed} of ${saved.length} couldn't be updated (stock can't go below what open orders hold).`);
      else toast.success(`Added ${qty} to ${chosen.length} variants.`);
    }
    setBulk(null);
    setBulkValue("");
    setChecked(new Set());
  }

  const total = draft.variants.length;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-2 border-t border-line-soft pt-1.5">
        <h3 className="font-display text-body-lg font-extrabold">Variants</h3>
        <span className="text-caption text-muted">{total.toLocaleString("en-NG")} combinations · {totalUnits(draft).toLocaleString("en-NG")} units</span>
      </div>

      {filterOptions.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {filterOptions.map((o) => (
            <label key={o.name} className="flex flex-col gap-0.5 text-micro font-bold text-muted">
              {o.name}
              <Dropdown value={filters[o.name] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [o.name]: e.target.value }))} className="h-[38px] rounded-md border-[1.5px] border-line-strong bg-surface px-2 text-label font-semibold text-ink">
                <option value="">All</option>
                {o.values.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </Dropdown>
            </label>
          ))}
        </div>
      ) : null}
      <label className="flex min-h-9 items-center gap-2 text-label"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="size-[18px] accent-primary" />Only show low or out of stock</label>

      {checked.size ? (
        <div className="sticky top-2 z-[1] flex flex-col gap-2 rounded-lg bg-surface-inverse p-2 pl-3.5 text-label text-on-inverse">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="flex-1">{checked.size} selected</strong>
            {!disabled ? <><button type="button" onClick={() => { setBulk("price"); setBulkValue(""); }} className="h-[34px] rounded-pill bg-primary px-2.5 font-bold">Set price</button>
            <button type="button" onClick={() => { setBulk("stock"); setBulkValue(""); }} className="h-[34px] rounded-pill bg-surface-inverse-raised px-2.5 font-bold">Add stock</button></> : null}
            <button type="button" aria-label="Clear selection" onClick={() => { setChecked(new Set()); setBulk(null); }} className="inline-flex size-[34px] items-center justify-center rounded-full"><X aria-hidden="true" size={16} /></button>
          </div>
          {bulk ? (
            <form className="flex flex-wrap items-center gap-2 pr-1.5" onSubmit={(e) => { e.preventDefault(); void applyBulk(); }}>
              <label className="flex items-center gap-2"><span>{bulk === "price" ? "New price (₦)" : "Units to add"}</span><input autoFocus inputMode="numeric" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="h-9 w-28 rounded-pill bg-surface px-3 text-ink" /></label>
              <Button type="submit" size="sm" loading={bulkBusy}>Apply</Button>
              <button type="button" onClick={() => setBulk(null)} className="underline">Cancel</button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {groups.map((g) => {
          const expanded = open === g.value.key;
          const limit = limits[g.value.key] ?? GROUP_PAGE;
          const shown = g.shown.slice(0, limit);
          return (
            <section key={g.value.key} className="overflow-hidden rounded-md border-[1.5px] border-line">
              <h4>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : g.value.key)} className={cn("flex min-h-12 w-full items-center gap-2.5 px-3 text-left", expanded ? "bg-surface-tint" : "bg-surface")}>
                  <span className="min-w-10 font-extrabold">{g.value.label}</span>
                  <span className="flex-1 text-caption text-muted">{g.all.length} variants · {g.units} in stock</span>
                  {g.low ? <span className="rounded-[9px] bg-danger-bg px-2 py-px text-micro font-bold text-danger">{g.low} low</span> : null}
                  {expanded ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
                </button>
              </h4>
              {expanded ? (
                <div className="flex flex-col">
                  {shown.map((v) => {
                    const k = keyOf(v);
                    const level = stockLevel(v);
                    const isOpen = row === k;
                    const name = variantName(draft, v) || draft.options[0]?.values.find((x) => x.key === v.values[draft.options[0]!.name])?.label || v.sku;
                    return (
                      <div key={k} className="border-t border-line-soft">
                        <div className="flex items-center gap-2 px-2.5 py-1">
                          {!disabled ? <input type="checkbox" aria-label={`Select ${name}`} checked={checked.has(k)} onChange={() => setChecked((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="size-[18px] shrink-0 accent-primary" /> : null}
                          <button type="button" aria-expanded={isOpen} onClick={() => setRow(isOpen ? null : k)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
                            <span className="flex min-w-0 flex-1 flex-col leading-[1.25]"><span className={cn("truncate text-label font-semibold", !v.active && "text-muted line-through")}>{name}</span><span className="text-micro text-muted">SKU {v.sku}{!v.id ? " · new" : ""}{!v.active ? " · hidden" : ""}</span></span>
                            <span className="text-label font-bold">{formatNaira(v.priceMinor)}</span>
                            <span className={cn("min-w-12 rounded-[10px] px-2 py-0.5 text-center text-caption font-bold", PILL[level])}>{level === "out" ? "Sold out" : availableOf(v)}</span>
                          </button>
                        </div>
                        {isOpen ? <RowEditor draft={draft} v={v} disabled={disabled} onEdit={(patch) => edit(v, patch)} onStock={(by) => changeStock(v, by)} onThreshold={(t) => void saveThreshold(v, t)} onDone={() => setRow(null)} /> : null}
                      </div>
                    );
                  })}
                  {g.shown.length === 0 ? <p className="border-t border-line-soft px-3 py-2.5 text-caption text-muted">No variants match the filters.</p> : null}
                  {g.shown.length > limit ? (
                    <div className="border-t border-line-soft px-3 py-2"><Button size="sm" variant="outline" onClick={() => setLimits((l) => ({ ...l, [g.value.key]: limit + GROUP_PAGE }))}>Show {Math.min(GROUP_PAGE, g.shown.length - limit)} more ({g.shown.length - limit} left)</Button></div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {active.length < draft.variants.length ? <p className="text-caption text-muted">{draft.variants.length - active.length} hidden variants aren&apos;t sold.</p> : null}
    </div>
  );
}

function RowEditor({ draft, v, disabled, onEdit, onStock, onThreshold, onDone }: { draft: MatrixDraft; v: VariantDraft; disabled: boolean; onEdit: (patch: Parameters<typeof updateVariant>[2]) => void; onStock: (by: number) => void; onThreshold: (text: string) => void; onDone: () => void }) {
  const computed = computedPrice(draft, v.values);
  const [custom, setCustom] = useState(hasCustomPrice(draft, v));
  const [price, setPrice] = useState(String(v.priceMinor / 100));
  const [sku, setSku] = useState(v.sku);
  return (
    <div className="mx-2.5 mb-2.5 grid grid-cols-2 gap-2.5 rounded-md bg-surface-subtle p-3">
      <div className="col-span-2 flex items-center justify-between gap-2 text-label">
        <span>Price from options: <strong>{formatNaira(computed)}</strong></span>
        <label className="flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={custom} disabled={disabled} onChange={(e) => { setCustom(e.target.checked); if (!e.target.checked) { onEdit({ priceMinor: computed }); setPrice(String(computed / 100)); } }} className="size-4 accent-primary" />Custom price</label>
      </div>
      {custom ? (
        <label className="col-span-2 flex flex-col gap-1 text-caption font-semibold">Price (₦)
          <input inputMode="numeric" value={price} disabled={disabled} onChange={(e) => setPrice(e.target.value)} onBlur={() => { const kobo = parseNairaDifference(price); if (kobo !== null && kobo > 0 && kobo !== v.priceMinor) onEdit({ priceMinor: kobo }); else setPrice(String(v.priceMinor / 100)); }} className="h-10 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
        </label>
      ) : null}
      <div className="flex flex-col gap-1 text-caption font-semibold">
        <span id={`stock-${keyOf(v)}`}>In stock</span>
        <span role="group" aria-labelledby={`stock-${keyOf(v)}`} className="flex h-10 items-center rounded-md border-[1.5px] border-line-strong bg-surface">
          <button type="button" aria-label="One less" disabled={disabled || v.onHand <= v.reserved} onClick={() => onStock(-1)} className="inline-flex h-full w-10 items-center justify-center disabled:opacity-40"><Minus aria-hidden="true" size={16} /></button>
          <output aria-live="polite" className="flex-1 text-center text-body-sm font-bold">{v.onHand}</output>
          <button type="button" aria-label="One more" disabled={disabled} onClick={() => onStock(1)} className="inline-flex h-full w-10 items-center justify-center disabled:opacity-40"><Plus aria-hidden="true" size={16} /></button>
        </span>
        {v.reserved ? <span className="font-normal text-muted">{v.reserved} held by open orders</span> : null}
      </div>
      <label className="flex flex-col gap-1 text-caption font-semibold">Warn me below
        <input inputMode="numeric" defaultValue={v.lowStockThreshold ?? ""} disabled={disabled} onBlur={(e) => onThreshold(e.target.value)} className="h-10 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-caption font-semibold">SKU
        <input value={sku} disabled={disabled} onChange={(e) => setSku(e.target.value)} onBlur={() => { if (sku !== v.sku) { onEdit({ sku }); } }} className="h-10 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      <div className="col-span-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="dark" onClick={onDone}>Done</Button>
        {!disabled ? <label className="flex items-center gap-1.5 text-label"><input type="checkbox" checked={v.active} onChange={(e) => onEdit({ active: e.target.checked })} className="size-4 accent-primary" />Sold in store</label> : null}
        <span className="text-caption text-muted">When it hits 0, customers see &ldquo;Sold out&rdquo;.</span>
      </div>
    </div>
  );
}
