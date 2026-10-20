import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useStoreHydrated } from "./hydrated";
import { browserStorage, registerPersisted } from "./persisted";

/**
 * The client owns the cart, and it holds nothing the server must trust: variant ids, quantities and promotion
 * codes. Names, photos, prices and totals come back from `POST /pricing/quote` every time.
 */
export type CartLine = { variantId: string; quantity: number };

/** Hard limits of the API (`/pricing/quote` and `/checkout` reject more). */
export const API_MAX_LINES = 50;
export const API_MAX_LINE_QUANTITY = 99;
export const API_MAX_CODES = 5;

// Hand-written rather than a schema library: this store loads on every page, and a validator this small should not
// add tens of kilobytes to the first load.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isLine = (v: unknown): v is CartLine => {
  const line = v as Partial<CartLine> | null;
  return typeof line?.variantId === "string" && UUID.test(line.variantId) && Number.isInteger(line.quantity) && line.quantity! >= 1 && line.quantity! <= API_MAX_LINE_QUANTITY;
};
const isCode = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64;

/** The stored bag if every part of it is valid, otherwise null: tampered or old data is dropped, never half-used. */
function parsePersisted(value: unknown): Pick<CartState, "lines" | "promotionCodes"> | null {
  const { lines, promotionCodes } = (value ?? {}) as { lines?: unknown; promotionCodes?: unknown };
  if (!Array.isArray(lines) || lines.length > API_MAX_LINES || !lines.every(isLine)) return null;
  if (!Array.isArray(promotionCodes) || promotionCodes.length > API_MAX_CODES || !promotionCodes.every(isCode)) return null;
  return { lines, promotionCodes };
}

export const normaliseCode = (code: string) => code.trim().toUpperCase();
const clampQuantity = (n: number) => Math.min(Math.max(Math.trunc(n), 1), API_MAX_LINE_QUANTITY);

type CartState = {
  lines: CartLine[];
  promotionCodes: string[];
  /** Adds to an existing line or appends a new one. Ignored when the bag already has the maximum number of lines. */
  add: (variantId: string, quantity?: number) => void;
  /** Sets an exact quantity (clamped to 1–99). Use `remove` to take a line out. */
  setQuantity: (variantId: string, quantity: number) => void;
  /** Removes a line and returns it with its position, so the UI can offer "Undo". */
  remove: (variantId: string) => { line: CartLine; index: number } | undefined;
  restore: (line: CartLine, index: number) => void;
  addCode: (code: string) => void;
  removeCode: (code: string) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      promotionCodes: [],
      add: (variantId, quantity = 1) =>
        set(({ lines }) => {
          const existing = lines.find((l) => l.variantId === variantId);
          if (existing) return { lines: lines.map((l) => (l === existing ? { ...l, quantity: clampQuantity(l.quantity + quantity) } : l)) };
          if (lines.length >= API_MAX_LINES) return {};
          return { lines: [...lines, { variantId, quantity: clampQuantity(quantity) }] };
        }),
      setQuantity: (variantId, quantity) => set(({ lines }) => ({ lines: lines.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQuantity(quantity) } : l)) })),
      remove: (variantId) => {
        const index = get().lines.findIndex((l) => l.variantId === variantId);
        if (index < 0) return undefined;
        const line = get().lines[index]!;
        set(({ lines }) => ({ lines: lines.filter((l) => l.variantId !== variantId) }));
        return { line, index };
      },
      restore: (line, index) =>
        set(({ lines }) => {
          if (lines.some((l) => l.variantId === line.variantId) || lines.length >= API_MAX_LINES) return {};
          const next = [...lines];
          next.splice(Math.min(index, next.length), 0, line);
          return { lines: next };
        }),
      addCode: (code) =>
        set(({ promotionCodes }) => {
          const normalised = normaliseCode(code);
          if (!normalised || promotionCodes.includes(normalised) || promotionCodes.length >= API_MAX_CODES) return {};
          return { promotionCodes: [...promotionCodes, normalised] };
        }),
      removeCode: (code) => set(({ promotionCodes }) => ({ promotionCodes: promotionCodes.filter((c) => c !== normaliseCode(code)) })),
      clear: () => set({ lines: [], promotionCodes: [] }),
    }),
    {
      name: "jh.cart.v1",
      version: 1,
      storage: browserStorage("local"),
      partialize: ({ lines, promotionCodes }) => ({ lines, promotionCodes }),
      // Hydrate after mount so server and first client render agree.
      skipHydration: true,
      // Anything tampered with or from an unknown future version is dropped rather than sent to the API.
      merge: (persisted, current) => ({ ...current, ...parsePersisted(persisted) }),
    },
  ),
);

registerPersisted(useCartStore);

/** Total units in the bag; zero until the store has hydrated so the header badge never mismatches. */
export function useCartCount(): number {
  const hydrated = useStoreHydrated(useCartStore);
  const count = useCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  return hydrated ? count : 0;
}
