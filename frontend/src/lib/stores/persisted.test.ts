import { create } from "zustand";
import { persist } from "zustand/middleware";
import { describe, expect, it } from "vitest";
import { browserStorage, registerPersisted, rehydrateAll } from "./persisted";

const makeStore = (name: string) => create<{ n: number }>()(persist(() => ({ n: 0 }), { name, storage: browserStorage("local"), skipHydration: true }));

describe("persisted stores", () => {
  it("fill a store that registers after the app-wide pass, as a lazily loaded module does", async () => {
    rehydrateAll();
    localStorage.setItem("late", JSON.stringify({ state: { n: 7 }, version: 0 }));
    const late = makeStore("late");
    expect(late.getState().n).toBe(0);
    registerPersisted(late);
    await Promise.resolve();
    expect(late.persist.hasHydrated()).toBe(true);
    expect(late.getState().n).toBe(7);
  });
});
