import { describe, expect, it } from "vitest";
import { barPercent, boughtLine, flagsFor, reviewerLine, reviewTab, starsText } from "./reviews";

describe("review text", () => {
  it("draws stars as text and clamps the rating", () => expect([starsText(4), starsText(5), starsText(0), starsText(9)]).toEqual(["★★★★☆", "★★★★★", "☆☆☆☆☆", "★★★★★"]));
  it("says what they bought and in which order", () => {
    expect(boughtLine({ variant: { Length: '20"', Density: "180%" }, orderNumber: "JH-10211" })).toBe('Bought 20" · 180% · order #JH-10211');
    expect(boughtLine({ variant: null, orderNumber: null })).toBe("");
  });
  it("shows the masked contact and place", () => expect(reviewerLine({ customerEmail: "a•••@x.co", customerPhone: null, location: "Lekki" })).toBe("a•••@x.co · Lekki"));
  it("picks the Waiting tab unless told otherwise", () => expect([reviewTab(null).status, reviewTab("published").status, reviewTab("hidden").status, reviewTab("x").status]).toEqual(["pending", "approved", "hidden", "pending"]));
});

describe("flagsFor", () => {
  const review = (body: string, rating = 5, title = "") => ({ title, body, rating });
  it("catches phone numbers, emails and links", () => {
    expect(flagsFor(review("Call me on 0803 000 0000"))).toEqual(["contains a phone number"]);
    expect(flagsFor(review("write to me@x.co"))).toEqual(["contains an email address"]);
    expect(flagsFor(review("see https://x.co or www.y.co"))).toEqual(["contains a link"]);
  });
  it("does not mistake sizes and prices for phone numbers", () => expect(flagsFor(review('20" 13x4 180% density, paid 150000'))).toEqual([]));
  it("suggests replying to low ratings, and says when it is about delivery", () => {
    expect(flagsFor(review("Delivery took 6 days", 2))).toEqual(["low rating about delivery, consider replying"]);
    expect(flagsFor(review("Shed a lot", 1))).toEqual(["low rating, consider replying"]);
    expect(flagsFor(review("Great", 3))).toEqual([]);
  });
});

describe("barPercent", () => {
  it("is a whole percentage of published reviews, zero when there are none", () => {
    const s = { count: 200, average: 4.5, distribution: [] };
    expect([barPercent(150, s), barPercent(1, s), barPercent(0, { ...s, count: 0 })]).toEqual([75, 1, 0]);
  });
});
