import { describe, expect, it } from "vitest";
import { lengthText, activeFilters, clearFilters, collectionFromSegments, countActiveFilters, emptyListState, hrefFor, parseListState, toApiParams, toSearchParams } from "./params";

describe("parseListState", () => {
  it("reads filters, price, toggles, sort and view", () => {
    const state = parseListState({ q: " bob ", texture: "body-wave", length: "14,20", colour: ["black", "brown"], minPrice: "80000", maxPrice: "250000", inStock: "1", onOffer: "true", sort: "priceAsc", view: "list" });
    expect(state).toEqual({
      q: "bob",
      options: { texture: ["body-wave"], length: ["14", "20"], colour: ["black", "brown"] },
      minPriceNaira: 80_000,
      maxPriceNaira: 250_000,
      inStock: true,
      onOffer: true,
      sort: "priceAsc",
      view: "list",
    });
  });

  it("falls back to defaults for nothing, and ignores junk instead of failing", () => {
    expect(parseListState({})).toEqual(emptyListState());
    const junk = parseListState({ sort: "cheapest", view: "tile", length: "<script>,14,,", minPrice: "-5", maxPrice: "abc", inStock: "yes", texture: "A B" });
    expect(junk).toEqual({ ...emptyListState(), options: { length: ["14"] } });
  });

  it("de-duplicates values, lower-cases them and caps how many are kept", () => {
    expect(parseListState({ length: ["14", "14,20", "14"] }).options.length).toEqual(["14", "20"]);
    expect(parseListState({ colour: "BLACK" }).options.colour).toEqual(["black"]);
    expect(parseListState({ length: Array.from({ length: 40 }, (_, i) => String(i)) }).options.length).toHaveLength(20);
  });

  it("repairs a reversed price range and caps absurd values", () => {
    const state = parseListState({ minPrice: "300000", maxPrice: "100000" });
    expect([state.minPriceNaira, state.maxPriceNaira]).toEqual([100_000, undefined]);
    expect(parseListState({ maxPrice: "999999999999" }).maxPriceNaira).toBeUndefined();
  });

  it("takes the first of a repeated single-value parameter, and truncates a huge query", () => {
    expect(parseListState({ sort: ["newest", "priceAsc"] }).sort).toBe("newest");
    expect(parseListState({ q: "x".repeat(500) }).q).toHaveLength(100);
    expect(parseListState({ q: "   " }).q).toBeUndefined();
  });
});

describe("toSearchParams and hrefFor", () => {
  it("leaves out defaults so links stay short, and round-trips", () => {
    expect(toSearchParams(emptyListState()).toString()).toBe("");
    const state = parseListState({ texture: "body-wave", length: "14,20", minPrice: "80000", sort: "newest", view: "list", inStock: "1" });
    const query = toSearchParams(state).toString();
    expect(query).toBe("texture=body-wave&length=14%2C20&minPrice=80000&inStock=1&sort=newest&view=list");
    expect(parseListState(Object.fromEntries(new URLSearchParams(query)))).toEqual(state);
    expect(hrefFor("/shop/frontal", state)).toBe(`/shop/frontal?${query}`);
    expect(hrefFor("/shop", emptyListState())).toBe("/shop");
  });
});

describe("toApiParams", () => {
  it("sends option values as arrays and prices in kobo", () => {
    const api = toApiParams(parseListState({ q: "bob", length: "14,20", minPrice: "80000", maxPrice: "250000", onOffer: "1", sort: "topRated" }), { limit: 20, cursor: "abc" });
    expect(api).toEqual({ q: "bob", length: ["14", "20"], minPrice: 8_000_000, maxPrice: 25_000_000, onOffer: true, sort: "topRated", limit: 20, cursor: "abc" });
  });

  it("omits everything that is not set", () => {
    expect(toApiParams(emptyListState())).toEqual({ sort: "recommended" });
  });
});

describe("activeFilters", () => {
  it("lists one removable chip per applied value, each removing only itself", () => {
    const state = parseListState({ texture: "body-wave", length: "14,20", minPrice: "80000", maxPrice: "250000", inStock: "1", onOffer: "1", q: "wig", sort: "newest" });
    const chips = activeFilters(state, { texture: { "body-wave": "Body wave" } });
    expect(chips.map((c) => c.label)).toEqual(["Body wave", '14"', '20"', "₦80,000 – ₦250,000", "In stock", "On offer"]);
    const without14 = chips.find((c) => c.key === "length:14")!.without;
    expect(without14.options.length).toEqual(["20"]);
    expect(without14.sort).toBe("newest");
    expect(chips.find((c) => c.key === "texture:body-wave")!.without.options.texture).toBeUndefined();
    expect(chips.find((c) => c.key === "price")!.without.minPriceNaira).toBeUndefined();
    expect(chips.find((c) => c.key === "inStock")!.without.inStock).toBe(false);
  });

  it("describes open-ended prices and humanises unknown values", () => {
    expect(activeFilters(parseListState({ minPrice: "50000" }))[0]!.label).toBe("From ₦50,000");
    expect(activeFilters(parseListState({ maxPrice: "90000" }))[0]!.label).toBe("Up to ₦90,000");
    expect(activeFilters(parseListState({ lace: "hd-lace" }))[0]!.label).toBe("Hd lace");
  });

  it("counts filters but not search, sort or view, and clearing keeps those", () => {
    const state = parseListState({ q: "bob", sort: "newest", view: "list", length: "14", inStock: "1" });
    expect(countActiveFilters(state)).toBe(2);
    expect(clearFilters(state)).toEqual({ ...emptyListState(), q: "bob", sort: "newest", view: "list" });
  });
});

describe("collectionFromSegments", () => {
  it("accepts exactly one valid slug", () => {
    expect(collectionFromSegments(["frontal-wigs"])).toBe("frontal-wigs");
    expect(collectionFromSegments(undefined)).toBeUndefined();
    expect(collectionFromSegments([])).toBeUndefined();
    expect(collectionFromSegments(["a", "b"])).toBeUndefined();
    expect(collectionFromSegments(["Not A Slug"])).toBeUndefined();
    expect(collectionFromSegments(["../etc"])).toBeUndefined();
  });
});

describe("lengthText", () => {
  it("adds the inch mark to a bare number and leaves a labelled length alone", () => {
    expect(lengthText("14")).toBe('14"');
    expect(lengthText("14.5")).toBe('14.5"');
    expect(lengthText('14"')).toBe('14"');
    expect(lengthText("14 inch")).toBe("14 inch");
  });
});
