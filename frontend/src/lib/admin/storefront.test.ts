import { describe, expect, it } from "vitest";
import type { ContentEntry } from "@/lib/api/admin-content";
import { emptyEntry, entryStatus, entryToForm, entryToPayload, isLinkUrl, mergeLayout, moveEntry, moveId, moveMessage, moveSection, showingText, toggleSection, validateEntry } from "./storefront";

describe("the layout", () => {
  it("shows every block in order when nothing is saved, and appends unknown ones hidden", () => {
    expect(mergeLayout(null).map((s) => s.type)).toEqual(["stories", "hero", "flash", "quiz", "products", "length", "tiles", "ugc", "trust"]);
    expect(mergeLayout(null).every((s) => s.enabled)).toBe(true);
    const saved = mergeLayout([{ type: "hero", enabled: true }, { type: "trust", enabled: false }]);
    expect(saved.slice(0, 2)).toEqual([{ type: "hero", enabled: true }, { type: "trust", enabled: false }]);
    expect(saved.slice(2).every((s) => !s.enabled)).toBe(true);
    expect(saved).toHaveLength(9);
  });
  it("moves a block up or down, never off the ends, and toggles one", () => {
    const l = mergeLayout(null);
    expect(moveSection(l, 1, -1).map((s) => s.type).slice(0, 2)).toEqual(["hero", "stories"]);
    expect(moveSection(l, 0, -1)).toBe(l);
    expect(moveSection(l, l.length - 1, 1)).toBe(l);
    expect(toggleSection(l, 2)[2]!.enabled).toBe(false);
    expect(toggleSection(l, 2)[1]!.enabled).toBe(true);
  });
  it("says what happened and how many are showing", () => {
    expect(moveMessage("Hero cards", 2, 9)).toBe("Hero cards moved to position 2 of 9");
    expect(showingText(toggleSection(mergeLayout(null), 0), true)).toBe("9 of 10 showing");
  });
});

describe("entry status", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  it("is told in words", () => {
    expect(entryStatus({ status: "draft", startsAt: null, endsAt: null }, now).label).toBe("Draft");
    expect(entryStatus({ status: "published", startsAt: null, endsAt: null }, now)).toEqual({ label: "Live", tone: "success" });
    expect(entryStatus({ status: "published", startsAt: "2026-10-30T00:00:00Z", endsAt: null }, now).label).toMatch(/^Starts /);
    expect(entryStatus({ status: "published", startsAt: null, endsAt: "2026-10-19T00:00:00Z" }, now).label).toMatch(/^Ended /);
    expect(entryStatus({ status: "archived", startsAt: null, endsAt: null }, now).label).toBe("Archived");
  });
});

describe("links", () => {
  it("allows site paths and http(s) links only", () => {
    expect(["/shop", "/p/wig?x=1", "https://x.co/a", "http://x.co"].every(isLinkUrl)).toBe(true);
    expect(["//evil.com", "/\\evil.com", "javascript:alert(1)", "shop", ""].some(isLinkUrl)).toBe(false);
  });
});

describe("entry forms", () => {
  const f = (over = {}) => ({ ...emptyEntry(), ...over });
  it("asks for what each kind needs", () => {
    expect(validateEntry("announcement", f())).toEqual({ main: "Write the message" });
    expect(validateEntry("banner", f({ main: "Hi", linkLabel: "Shop" })).linkUrl).toBe("Say where the button goes");
    expect(validateEntry("banner", f({ main: "Hi", linkUrl: "/shop" })).linkLabel).toBe("Say what the button says");
    expect(validateEntry("story", f({ main: "New" })).linkUrl).toBeDefined();
    expect(validateEntry("story", f({ main: "New", linkUrl: "//evil.com" })).linkUrl).toMatch(/starting with https/);
    expect(validateEntry("flash", f()).promotionId).toBeDefined();
    expect(validateEntry("story", f({ main: "x".repeat(41), linkUrl: "/shop" })).main).toBe("Keep it under 40 characters");
    expect(validateEntry("announcement", f({ main: "Sale", startsAt: "2026-10-25T10:00", endsAt: "2026-10-25T09:00" })).endsAt).toBeDefined();
    expect(validateEntry("announcement", f({ main: "Sale" }))).toEqual({});
  });
  it("builds the API body, leaving out empty optional fields", () => {
    expect(entryToPayload("announcement", f({ main: " Sale ", linkUrl: "/shop" }))).toEqual({ title: "Sale", body: { text: "Sale", linkUrl: "/shop" }, startsAt: null, endsAt: null });
    expect(entryToPayload("banner", f({ main: "Hi", tone: "plum", linkLabel: "Shop", linkUrl: "/shop", startsAt: "2026-10-25T00:00" })).body).toEqual({ headline: "Hi", tone: "plum", ctaLabel: "Shop", ctaUrl: "/shop" });
    expect(entryToPayload("story", f({ main: "New", linkUrl: "/shop", highlight: true })).body).toEqual({ title: "New", linkUrl: "/shop", highlight: true });
    expect(entryToPayload("flash", f({ promotionId: "p1" }))).toMatchObject({ title: "Flash deal", body: { promotionId: "p1" } });
  });
  it("reads an entry back into the form", () => {
    const e = { contentType: "banner", title: "x", body: { headline: "Hi", subheadline: "Sub", tag: "NEW", tone: "blush", ctaLabel: "Shop", ctaUrl: "/shop" }, startsAt: "2026-10-24T23:00:00.000Z", endsAt: null } as unknown as ContentEntry;
    expect(entryToForm(e)).toMatchObject({ main: "Hi", secondary: "Sub", tag: "NEW", tone: "blush", linkLabel: "Shop", linkUrl: "/shop", startsAt: "2026-10-25T00:00", endsAt: "" });
  });
});

describe("ordering", () => {
  it("swaps neighbours by id", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveEntry(items, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(moveEntry(items, "a", -1)).toBe(items);
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });
});
