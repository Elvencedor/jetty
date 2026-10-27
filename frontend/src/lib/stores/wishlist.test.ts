import { beforeEach, describe, expect, it } from "vitest";
import { useWishlistStore, WISHLIST_MAX } from "./wishlist";

beforeEach(() => {
  localStorage.clear();
  useWishlistStore.setState({ slugs: [] });
});

describe("wishlist store", () => {
  it("toggles a product on and off, newest first", () => {
    const { toggle } = useWishlistStore.getState();
    toggle("a");
    toggle("b");
    expect(useWishlistStore.getState().slugs).toEqual(["b", "a"]);
    toggle("a");
    expect(useWishlistStore.getState().slugs).toEqual(["b"]);
  });

  it("caps the list, dropping the oldest", () => {
    const { toggle } = useWishlistStore.getState();
    for (let i = 0; i < WISHLIST_MAX + 5; i++) toggle(`p-${i}`);
    const { slugs } = useWishlistStore.getState();
    expect(slugs).toHaveLength(WISHLIST_MAX);
    expect(slugs[0]).toBe(`p-${WISHLIST_MAX + 4}`);
  });

  it("drops invalid or duplicated stored slugs on hydration", async () => {
    localStorage.setItem("jh.wishlist.v1", JSON.stringify({ state: { slugs: ["ok", "ok", "Bad Slug", 5, "../x", "fine-2"] }, version: 1 }));
    await useWishlistStore.persist.rehydrate();
    expect(useWishlistStore.getState().slugs).toEqual(["ok", "fine-2"]);
  });

  it("ignores stored data of the wrong shape", async () => {
    localStorage.setItem("jh.wishlist.v1", JSON.stringify({ state: { slugs: "nope" }, version: 1 }));
    await useWishlistStore.persist.rehydrate();
    expect(useWishlistStore.getState().slugs).toEqual([]);
  });
});
