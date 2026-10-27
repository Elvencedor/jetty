import { describe, expect, it } from "vitest";
import { avatarTone, averageOrder, displayName, initials, monthYear, placeOf, segmentFromParam } from "./customers";

describe("who a customer is", () => {
  it("uses the name given, then the email, then the phone", () => {
    expect(displayName({ name: " Ada Okafor ", email: "a@b.co", phone: "+234" })).toBe("Ada Okafor");
    expect(displayName({ name: null, email: "a@b.co", phone: "+234" })).toBe("a@b.co");
    expect(displayName({ name: null, email: null, phone: "+2348030000000" })).toBe("+2348030000000");
  });
  it("makes initials from first and last name, or the first letter of a contact", () => {
    expect([initials({ name: "Adaeze Okafor", email: null, phone: null }), initials({ name: "Bisi", email: null, phone: null }), initials({ name: "Ngozi Chioma Eze", email: null, phone: null }), initials({ name: null, email: "tolu@x.co", phone: null }), initials({ name: null, email: null, phone: "+2348030000000" })]).toEqual(["AO", "BI", "NE", "T", "2"]);
  });
  it("gives a customer the same avatar colour every time", () => {
    expect(avatarTone("abc")).toBe(avatarTone("abc"));
    expect(avatarTone("abc")).toBeGreaterThanOrEqual(0);
    expect(avatarTone("abc")).toBeLessThan(5);
  });
});

describe("figures and places", () => {
  it("averages over orders without dividing by zero", () => expect([averageOrder(4, 1_000_000), averageOrder(0, 0), averageOrder(3, 100)]).toEqual([250_000, 0, 33]));
  it("joins the parts of a place that exist", () => expect([placeOf({ area: "Lekki", state: "Lagos" }), placeOf({ area: null, state: "Lagos" }), placeOf({ area: null, state: null })]).toEqual(["Lekki, Lagos", "Lagos", ""]));
  it("writes the month and year in Lagos time", () => expect(monthYear("2026-03-02T10:00:00Z")).toBe("Mar 2026"));
  it("reads only known segments from the address", () => expect([segmentFromParam("vip"), segmentFromParam("nope"), segmentFromParam(null)]).toEqual(["vip", null, null]));
});
