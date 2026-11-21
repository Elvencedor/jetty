import { useMemo } from "react";
import { create } from "zustand";
import { useAdminSession } from "@/lib/stores/session";

/** What the selection remembers about an item, so it can be listed and described when its page is not on screen. */
export type SelectionItem = { id: string; label: string; /** A short note shown beside the name in the review list, like its status. */ detail?: string };

/** The most a bulk change takes at once. Matches the API. */
export const MAX_SELECTION = 500;

type State = {
  /** One selection per kind of thing ("products", "categories"), each keyed by id in the order items were picked. */
  byResource: Record<string, Record<string, SelectionItem>>;
  /** Selects or deselects one item. Returns false when the limit stopped it. */
  toggle: (resource: string, item: SelectionItem) => boolean;
  /** Adds (`on`) or removes many at once. `limited` is true when the limit stopped some being added. */
  setMany: (resource: string, items: SelectionItem[], on: boolean) => { limited: boolean };
  remove: (resource: string, ids: string[]) => void;
  clear: (resource: string) => void;
};

/**
 * The admin's selections, kept apart from any list's data, so paging, filtering and searching never lose them. Selecting
 * five on page one, loading page two and filtering the list all leave them as they were; only the admin clears them.
 */
export const useSelectionStore = create<State>()((set, get) => ({
  byResource: {},
  toggle: (resource, item) => {
    const current = get().byResource[resource] ?? {};
    if (item.id in current) {
      const { [item.id]: _removed, ...rest } = current;
      set((s) => ({ byResource: { ...s.byResource, [resource]: rest } }));
      return true;
    }
    if (Object.keys(current).length >= MAX_SELECTION) return false;
    set((s) => ({ byResource: { ...s.byResource, [resource]: { ...current, [item.id]: item } } }));
    return true;
  },
  setMany: (resource, items, on) => {
    const current = get().byResource[resource] ?? {};
    const next = { ...current };
    let limited = false;
    for (const item of items) {
      if (!on) delete next[item.id];
      else if (item.id in next) next[item.id] = item;
      else if (Object.keys(next).length >= MAX_SELECTION) limited = true;
      else next[item.id] = item;
    }
    set((s) => ({ byResource: { ...s.byResource, [resource]: next } }));
    return { limited };
  },
  remove: (resource, ids) => {
    const current = get().byResource[resource];
    if (!current) return;
    const drop = new Set(ids);
    set((s) => ({ byResource: { ...s.byResource, [resource]: Object.fromEntries(Object.entries(current).filter(([id]) => !drop.has(id))) } }));
  },
  clear: (resource) => set((s) => ({ byResource: { ...s.byResource, [resource]: {} } })),
}));

// Signing out ends the selection too: the next person to use this browser starts with nothing selected.
useAdminSession.subscribe((session) => {
  if (session.status === "anonymous") useSelectionStore.setState({ byResource: {} });
});

const NONE: Record<string, SelectionItem> = {};

/** One kind of thing's selection: who is selected, and how to change it. */
export function useSelection(resource: string) {
  const picked = useSelectionStore((s) => s.byResource[resource]) ?? NONE;
  const toggle = useSelectionStore((s) => s.toggle);
  const setMany = useSelectionStore((s) => s.setMany);
  const remove = useSelectionStore((s) => s.remove);
  const clear = useSelectionStore((s) => s.clear);
  return useMemo(
    () => ({
      items: Object.values(picked),
      ids: Object.keys(picked),
      count: Object.keys(picked).length,
      has: (id: string) => id in picked,
      toggle: (item: SelectionItem) => toggle(resource, item),
      setMany: (items: SelectionItem[], on: boolean) => setMany(resource, items, on),
      remove: (ids: string[]) => remove(resource, ids),
      clear: () => clear(resource),
    }),
    [picked, resource, toggle, setMany, remove, clear],
  );
}

/** The ids from one item to another, both included, in the order they are listed: for shift-click range selection. */
export function rangeBetween(ordered: string[], a: string, b: string): string[] {
  const i = ordered.indexOf(a);
  const j = ordered.indexOf(b);
  if (i < 0 || j < 0) return [b].filter((id) => ordered.includes(id));
  return ordered.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** How a list's selection looks in its "select all" box: nothing, some, or every item shown. */
export function selectAllState(shown: string[], has: (id: string) => boolean): "none" | "some" | "all" {
  if (shown.length === 0) return "none";
  const chosen = shown.filter(has).length;
  return chosen === 0 ? "none" : chosen === shown.length ? "all" : "some";
}
