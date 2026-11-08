"use client";

import { ChevronDown, ChevronUp, Minus, Plus, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Dropdown, Switch } from "@/components/ui";
import { minorToAmountText, onAmountChange } from "@/lib/admin/amount";
import { adminErrorMessage } from "@/lib/admin/concurrency";
import { availableOf, bucketVariants, computedPrice, hasCustomPrice, stockLevel, totalUnits, updateVariant, variantName, type MatrixDraft, type StockLevel, type VariantDraft } from "@/lib/admin/matrix";
import { adjustStock } from "@/lib/api/admin-catalog";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";
import { toast } from "@/lib/stores/toast";
import { parseNairaDifference } from "./OptionCard";

/** How many rows a group shows before "Show more". */
const GROUP_PAGE = 25;
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

/**
 * The variants as a compact table you can work in without opening anything: price and stock are edited in the row. Group them
 * by any option (or none), filter on every option, search by SKU, and select a whole group to set its price or add stock.
 */
export function VariantList({ draft, disabled, onChange, onBaseline }: Props) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [lowOnly, setLowOnly] = useState(false);
  const [search, setSearch] = useState("");
  // On a phone the per-option filters sit behind a button; from the small breakpoint up they are always shown.
  const [showFilters, setShowFilters] = useState(false);
  // Grouped by the first option unless the owner chose otherwise; an option that was since deleted falls back to the first.
  const [groupChoice, setGroupChoice] = useState<string | null | undefined>(undefined);
  const groupBy = groupChoice === null ? null : (draft.options.find((o) => o.name === groupChoice)?.name ?? draft.options[0]?.name ?? null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([draft.options[0]?.values[0]?.key ?? "all"]));
  const [details, setDetails] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [bulk, setBulk] = useState<"price" | "stock" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Stock taps waiting to be written, per saved variant.
  const pending = useRef(new Map<string, { delta: number; timer: ReturnType<typeof setTimeout> }>());

  const buckets = bucketVariants(draft, groupBy, { values: filters, lowOnly, search });
  const active = draft.variants.filter((v) => v.active);
  const filtering = lowOnly || search.trim() !== "" || Object.values(filters).some(Boolean);
  const activeFilters = Object.values(filters).filter(Boolean).length + (lowOnly ? 1 : 0);
  const shownTotal = buckets.reduce((n, g) => n + g.shown.length, 0);

  // Stock is written to the server as you go, so the draft and what the server has move together. These are updaters,
  // applied to the newest state, so a late response never overwrites an edit made while it was on its way.
  const patchStock = (id: string, patch: (v: VariantDraft) => Partial<VariantDraft>) => {
    const apply = (m: MatrixDraft): MatrixDraft => ({ ...m, variants: m.variants.map((v) => (v.id === id ? { ...v, ...patch(v) } : v)) });
    onChange(apply);
    onBaseline(apply);
  };
  const setOnHand = (id: string, onHand: number, threshold?: number | null) => patchStock(id, () => ({ onHand, ...(threshold !== undefined ? { lowStockThreshold: threshold } : {}) }));

  function changeStock(v: VariantDraft, by: number) {
    if (by === 0) return;
    if (v.onHand + by < v.reserved || v.onHand + by < 0) return void toast.error(v.reserved ? `Stock can't go below ${v.reserved}: open orders are holding that many.` : "Stock can't go below 0.");
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
  const toggleIn = (set: ReadonlySet<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n; };
  const selectAll = (rows: VariantDraft[], on: boolean) => setChecked((c) => { const n = new Set(c); for (const v of rows) { if (on) n.add(keyOf(v)); else n.delete(keyOf(v)); } return n; });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-body-lg font-extrabold">Variants</h3>
        <span className="text-caption text-muted">{total.toLocaleString("en-NG")} combinations · {totalUnits(draft).toLocaleString("en-NG")} units</span>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg bg-surface-subtle p-3">
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:max-w-48">
            <label htmlFor="variant-group-by" className="text-micro font-bold text-muted">Group by</label>
            <Dropdown id="variant-group-by" value={groupBy ?? ""} onChange={(e) => { setGroupChoice(e.target.value === "" ? null : e.target.value); setExpanded(new Set()); }} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-2 text-label font-semibold text-ink sm:h-[38px]">
              <option value="">No grouping</option>
              {draft.options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
            </Dropdown>
          </div>
          <button type="button" aria-expanded={showFilters} aria-controls="variant-filters" onClick={() => setShowFilters((x) => !x)} className="inline-flex h-11 items-center gap-1.5 rounded-md border-[1.5px] border-line-strong bg-surface px-3 text-label font-bold sm:hidden">
            Filters{activeFilters ? <span className="rounded-full bg-primary px-1.5 text-micro text-on-primary">{activeFilters}</span> : null}
            {showFilters ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
          </button>
        </div>
        <div id="variant-filters" className={cn("grid-cols-2 gap-2 sm:flex sm:flex-wrap", showFilters ? "grid" : "hidden sm:flex")}>
          {draft.options.map((o) => (
            <div key={o.name} className="flex min-w-0 flex-col gap-0.5 sm:min-w-32">
              <label htmlFor={`variant-filter-${o.name}`} className="text-micro font-bold text-muted">{o.name}</label>
              <Dropdown id={`variant-filter-${o.name}`} value={filters[o.name] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [o.name]: e.target.value }))} className="h-11 rounded-md border-[1.5px] border-line-strong bg-surface px-2 text-label font-semibold text-ink sm:h-[38px]">
                <option value="">All</option>
                {o.values.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </Dropdown>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">Search variants</span>
            <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by SKU or name" className="h-11 w-full rounded-md border-[1.5px] border-line-strong bg-surface pl-9 pr-3 text-label sm:h-[38px]" />
          </label>
          <label className="flex min-h-9 items-center gap-2 text-label"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="size-[18px] accent-primary" />Only low or out of stock</label>
          {groupBy ? (
            <span className="flex items-center gap-1.5 text-label">
              <button type="button" onClick={() => setExpanded(new Set(buckets.map((g) => g.key)))} className="font-bold text-primary-strong underline">Open all</button>
              <span aria-hidden="true" className="text-muted">·</span>
              <button type="button" onClick={() => setExpanded(new Set())} className="font-bold text-primary-strong underline">Close all</button>
            </span>
          ) : null}
        </div>
        {filtering ? (
          <p role="status" className="text-caption text-muted">
            Showing {shownTotal.toLocaleString("en-NG")} of {total.toLocaleString("en-NG")}.{" "}
            <button type="button" onClick={() => { setFilters({}); setLowOnly(false); setSearch(""); }} className="font-bold text-primary-strong underline">Clear filters</button>
          </p>
        ) : null}
      </div>

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
              <label className="flex items-center gap-2"><span>{bulk === "price" ? "New price (₦)" : "Units to add"}</span><input autoFocus inputMode="numeric" value={bulkValue} onChange={bulk === "price" ? onAmountChange(bulkValue, setBulkValue, { decimal: false }) : (e) => setBulkValue(e.target.value)} className="h-9 w-28 rounded-pill bg-surface px-3 text-ink" /></label>
              <Button type="submit" size="sm" loading={bulkBusy}>Apply</Button>
              <button type="button" onClick={() => setBulk(null)} className="underline">Cancel</button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {buckets.map((g) => {
          const grouped = groupBy !== null;
          const open = !grouped || expanded.has(g.key);
          const limit = limits[g.key] ?? GROUP_PAGE;
          const rows = g.shown.slice(0, limit);
          const allChecked = g.shown.length > 0 && g.shown.every((v) => checked.has(keyOf(v)));
          // Hide a group the filters empty, unless nothing is filtered (a group with no variants still tells you so).
          if (filtering && g.shown.length === 0) return null;
          return (
            <section key={g.key} aria-label={g.label} className="overflow-hidden rounded-md border-[1.5px] border-line">
              {grouped ? (
                <div className={cn("flex min-h-12 items-center gap-2 px-3", open ? "bg-surface-tint" : "bg-surface")}>
                  {!disabled ? <input type="checkbox" aria-label={`Select every variant in ${g.label}`} checked={allChecked} onChange={(e) => selectAll(g.shown, e.target.checked)} className="size-[18px] shrink-0 accent-primary" /> : null}
                  <h4 className="min-w-0 flex-1">
                    <button type="button" aria-expanded={open} onClick={() => setExpanded((x) => toggleIn(x, g.key))} className="flex min-h-12 w-full items-center gap-2.5 text-left">
                      <span className="min-w-10 font-extrabold">{g.label}</span>
                      <span className="flex-1 text-caption text-muted">{g.all.length} {g.all.length === 1 ? "variant" : "variants"} · {g.units} in stock</span>
                      {g.low ? <span className="rounded-[9px] bg-danger-bg px-2 py-px text-micro font-bold text-danger">{g.low} low</span> : null}
                      {open ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
                    </button>
                  </h4>
                </div>
              ) : null}
              {open ? (
                <div className="flex flex-col">
                  {rows.map((v) => {
                    const k = keyOf(v);
                    return (
                      <VariantRow
                        key={k}
                        draft={draft}
                        v={v}
                        omit={groupBy}
                        disabled={disabled}
                        selected={checked.has(k)}
                        detailsOpen={details === k}
                        onSelect={() => setChecked((c) => toggleIn(c, k))}
                        onDetails={() => setDetails(details === k ? null : k)}
                        onEdit={(patch) => edit(v, patch)}
                        onStock={(by) => changeStock(v, by)}
                        onThreshold={(t) => void saveThreshold(v, t)}
                      />
                    );
                  })}
                  {g.shown.length === 0 ? <p className="border-t border-line-soft px-3 py-2.5 text-caption text-muted">No variants yet.</p> : null}
                  {g.shown.length > limit ? (
                    <div className="border-t border-line-soft px-3 py-2"><Button size="sm" variant="outline" onClick={() => setLimits((l) => ({ ...l, [g.key]: limit + GROUP_PAGE }))}>Show {Math.min(GROUP_PAGE, g.shown.length - limit)} more ({g.shown.length - limit} left)</Button></div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
        {filtering && shownTotal === 0 ? <p className="rounded-md border-[1.5px] border-dashed border-line-accent p-4 text-center text-label text-muted">No variants match. Try clearing a filter.</p> : null}
      </div>
      {active.length < draft.variants.length ? <p className="text-caption text-muted">{draft.variants.length - active.length} hidden variants aren&apos;t sold.</p> : null}
    </div>
  );
}

/** One variant on one line: what it is, its price and stock to edit in place, whether it is sold, and a ⋯ for the rest. */
function VariantRow({ draft, v, omit, disabled, selected, detailsOpen, onSelect, onDetails, onEdit, onStock, onThreshold }: {
  draft: MatrixDraft;
  v: VariantDraft;
  /** The option the list is grouped by: its value is the group's title already, so the row leaves it out. */
  omit: string | null;
  disabled: boolean;
  selected: boolean;
  detailsOpen: boolean;
  onSelect: () => void;
  onDetails: () => void;
  onEdit: (patch: Parameters<typeof updateVariant>[2]) => void;
  onStock: (by: number) => void;
  onThreshold: (text: string) => void;
}) {
  const level = stockLevel(v);
  const full = variantName(draft, v) || v.sku;
  const name = omit
    ? draft.options.filter((o) => o.name !== omit).map((o) => o.values.find((x) => x.key === v.values[o.name])?.label).filter(Boolean).join(" · ") || full
    : full;
  const [price, setPrice] = useState(minorToAmountText(v.priceMinor));
  const [units, setUnits] = useState(String(v.onHand));
  // Keep what is typed in step with the saved value when it changes from elsewhere (a bulk edit, a stock tap).
  const [seen, setSeen] = useState({ price: v.priceMinor, onHand: v.onHand });
  if (seen.price !== v.priceMinor || seen.onHand !== v.onHand) {
    setSeen({ price: v.priceMinor, onHand: v.onHand });
    setPrice(minorToAmountText(v.priceMinor));
    setUnits(String(v.onHand));
  }
  const custom = hasCustomPrice(draft, v);

  function commitPrice() {
    const kobo = parseNairaDifference(price);
    if (kobo === null || kobo <= 0) return setPrice(minorToAmountText(v.priceMinor));
    if (kobo !== v.priceMinor) onEdit({ priceMinor: kobo });
  }
  function commitUnits() {
    const n = Number(units);
    if (!Number.isInteger(n) || n < 0) return setUnits(String(v.onHand));
    if (n !== v.onHand) onStock(n - v.onHand);
  }

  return (
    <div className="border-t border-line-soft first:border-t-0">
      {/* A phone gets two lines: what it is and whether it sells, then price and stock side by side. From sm up it is one row. */}
      <div className="grid grid-cols-2 items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex sm:flex-wrap sm:py-2">
        <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:min-w-40 sm:flex-1">
          {!disabled ? <input type="checkbox" aria-label={`Select ${name}`} checked={selected} onChange={onSelect} className="size-5 shrink-0 accent-primary sm:size-[18px]" /> : null}
          <div className="flex min-w-0 flex-1 flex-col leading-[1.25]">
            <span className={cn("truncate text-label font-semibold", !v.active && "text-muted line-through")}>{name}</span>
            <span className="truncate text-micro text-muted">SKU {v.sku}{!v.id ? " · new" : ""}{!v.active ? " · hidden" : ""}</span>
          </div>
          {!disabled ? <span className="sm:hidden"><Switch label={`Sold in store: ${name}`} checked={v.active} onChange={(on) => onEdit({ active: on })} /></span> : null}
        </div>
        <label className="flex flex-col gap-0.5 text-micro font-bold text-muted">
          <span>Price (₦){custom ? " · custom" : ""}</span>
          <input aria-label={`Price for ${name}`} inputMode="numeric" value={price} disabled={disabled} onChange={onAmountChange(price, setPrice, { decimal: false })} onBlur={commitPrice} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="h-11 w-full rounded-md border-[1.5px] border-line-strong bg-surface px-2.5 text-label font-semibold text-ink sm:h-9 sm:w-28" />
        </label>
        <div className="flex flex-col gap-0.5 text-micro font-bold text-muted">
          <span className="flex items-center gap-1.5">In stock <span className={cn("rounded-[9px] px-1.5 py-px", PILL[level])}>{level === "out" ? "Sold out" : `${availableOf(v)} free`}</span></span>
          <span role="group" aria-label={`Stock for ${name}`} className="flex h-11 items-center rounded-md border-[1.5px] border-line-strong bg-surface sm:h-9">
            <button type="button" aria-label={`One less ${name}`} disabled={disabled || v.onHand <= v.reserved} onClick={() => onStock(-1)} className="inline-flex h-full w-11 items-center justify-center disabled:opacity-40 sm:w-8"><Minus aria-hidden="true" size={16} /></button>
            <input aria-label={`Units in stock of ${name}`} inputMode="numeric" value={units} disabled={disabled} onChange={(e) => setUnits(e.target.value)} onBlur={commitUnits} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-label font-bold text-ink outline-none sm:w-12 sm:flex-none" />
            <button type="button" aria-label={`One more ${name}`} disabled={disabled} onClick={() => onStock(1)} className="inline-flex h-full w-11 items-center justify-center disabled:opacity-40 sm:w-8"><Plus aria-hidden="true" size={16} /></button>
          </span>
        </div>
        {!disabled ? <span className="hidden sm:inline-flex"><Switch label={`Sold in store: ${name}`} checked={v.active} onChange={(on) => onEdit({ active: on })} /></span> : null}
        <button type="button" aria-expanded={detailsOpen} aria-label={`More for ${name}`} onClick={onDetails} className="col-span-2 h-9 justify-self-start rounded-pill px-3 text-label font-bold text-primary-strong hover:bg-surface-tint sm:col-auto">{detailsOpen ? "Less" : "More"}</button>
      </div>
      {detailsOpen ? <RowDetails draft={draft} v={v} disabled={disabled} onEdit={onEdit} onThreshold={onThreshold} /> : null}
    </div>
  );
}

function RowDetails({ draft, v, disabled, onEdit, onThreshold }: { draft: MatrixDraft; v: VariantDraft; disabled: boolean; onEdit: (patch: Parameters<typeof updateVariant>[2]) => void; onThreshold: (text: string) => void }) {
  const computed = computedPrice(draft, v.values);
  const [sku, setSku] = useState(v.sku);
  return (
    <div className="mx-3 mb-3 grid gap-2.5 rounded-md bg-surface-subtle p-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-caption font-semibold">SKU
        <input value={sku} disabled={disabled} onChange={(e) => setSku(e.target.value)} onBlur={() => { if (sku !== v.sku) onEdit({ sku }); }} className="h-10 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-caption font-semibold">Warn me when stock drops below
        <input inputMode="numeric" defaultValue={v.lowStockThreshold ?? ""} disabled={disabled} onBlur={(e) => onThreshold(e.target.value)} className="h-10 rounded-md border-[1.5px] border-line-strong bg-surface px-3 font-normal" />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-label sm:col-span-2">
        <span>Price from the options: <strong>{formatNaira(computed)}</strong></span>
        {hasCustomPrice(draft, v) && !disabled ? <Button size="sm" variant="outline" onClick={() => onEdit({ priceMinor: computed })}>Use this price</Button> : <span className="text-muted">(this variant uses it)</span>}
      </div>
      <p className="text-caption text-muted sm:col-span-2">{v.reserved ? `${v.reserved} held by open orders. ` : ""}When stock reaches 0, customers see &ldquo;Sold out&rdquo;.</p>
    </div>
  );
}
