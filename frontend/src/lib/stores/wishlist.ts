import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useStoreHydrated } from "./hydrated";
import { browserStorage, registerPersisted } from "./persisted";

/** Saved products, kept on this device only (a server wishlist is a later feature). Slugs, newest first. */
export const WISHLIST_MAX = 200;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type WishlistState = {
  slugs: string[];
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
  clear: () => void;
};

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      slugs: [],
      toggle: (slug) =>
        set(({ slugs }) => {
          if (slugs.includes(slug)) return { slugs: slugs.filter((s) => s !== slug) };
          return { slugs: [slug, ...slugs].slice(0, WISHLIST_MAX) };
        }),
      remove: (slug) => set(({ slugs }) => ({ slugs: slugs.filter((s) => s !== slug) })),
      clear: () => set({ slugs: [] }),
    }),
    {
      name: "jh.wishlist.v1",
      version: 1,
      storage: browserStorage("local"),
      partialize: ({ slugs }) => ({ slugs }),
      skipHydration: true,
      merge: (persisted, current) => {
        const slugs = (persisted as { slugs?: unknown } | null)?.slugs;
        if (!Array.isArray(slugs)) return current;
        const valid = [...new Set(slugs.filter((s): s is string => typeof s === "string" && s.length <= 120 && SLUG.test(s)))].slice(0, WISHLIST_MAX);
        return { ...current, slugs: valid };
      },
    },
  ),
);

registerPersisted(useWishlistStore);

/** Whether a product is saved; false until the store has hydrated so server and client markup agree. */
export function useIsSaved(slug: string): boolean {
  const hydrated = useStoreHydrated(useWishlistStore);
  const saved = useWishlistStore((s) => s.slugs.includes(slug));
  return hydrated && saved;
}

export function useSavedSlugs(): { slugs: string[]; hydrated: boolean } {
  const hydrated = useStoreHydrated(useWishlistStore);
  const slugs = useWishlistStore((s) => s.slugs);
  return { slugs: hydrated ? slugs : [], hydrated };
}
