import { create } from "zustand";
import { persist } from "zustand/middleware";
import { browserStorage, registerPersisted } from "./persisted";
import type { ListView } from "@/lib/catalog/params";

/** Small remembered choices, such as how the shopper likes to see product lists. */
type UiPrefs = {
  listView: ListView;
  setListView: (view: ListView) => void;
};

export const useUiPrefs = create<UiPrefs>()(
  persist(
    (set) => ({ listView: "grid", setListView: (listView) => set({ listView }) }),
    {
      name: "jh.ui-prefs.v1",
      version: 1,
      storage: browserStorage("local"),
      partialize: ({ listView }) => ({ listView }),
      skipHydration: true,
      merge: (persisted, current) => {
        const view = (persisted as { listView?: unknown } | null)?.listView;
        return view === "list" || view === "grid" ? { ...current, listView: view } : current;
      },
    },
  ),
);

registerPersisted(useUiPrefs);
