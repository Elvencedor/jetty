import { describe, expect, it } from "vitest";
import type { RevenuePoint } from "@/lib/api/admin-dashboard";
import { axisTicks, biggestDrop, campaignTag, chartSummary, daysIn, deltaOf, funnelSteps, headline, intervalFor, linePoints, rangeBounds, rangeFromParams } from "./dashboard";

describe("range", () => {
  it("reads a preset or a valid custom range from the address, and falls back to 30 days", () => {
    expect(rangeFromParams("7d", null, null).key).toBe("7d");
    expect(rangeFromParams("custom", "2026-01-05", "2026-01-20")).toEqual({ key: "custom", from: "2026-01-05", to: "2026-01-20" });
    expect(rangeFromParams("custom", "2026-01-20", "2026-01-05").key).toBe("30d");
    expect(rangeFromParams("custom", "nope", "2026-01-05").key).toBe("30d");
    expect(rangeFromParams("custom", "2024-01-01", "2026-01-05").key).toBe("30d");
    expect(rangeFromParams("whatever", null, null).key).toBe("30d");
  });
  it("turns days into instants: Lagos midnight, last day included, never in the future", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(rangeBounds({ key: "7d", from: null, to: null }, now)).toEqual({ from: "2026-10-13T12:00:00.000Z", to: "2026-10-20T12:00:00.000Z" });
    expect(rangeBounds({ key: "custom", from: "2026-10-01", to: "2026-10-02" }, now)).toEqual({ from: "2026-09-30T23:00:00.000Z", to: "2026-10-02T23:00:00.000Z" });
    expect(rangeBounds({ key: "custom", from: "2026-10-19", to: "2026-10-20" }, now).to).toBe(now.toISOString());
  });
  it("counts days and picks day, week or month buckets", () => {
    expect(daysIn({ key: "custom", from: "2026-10-01", to: "2026-10-10" })).toBe(10);
    expect([intervalFor(7), intervalFor(30), intervalFor(90), intervalFor(366)]).toEqual(["day", "day", "week", "month"]);
  });
});

describe("deltas and headline", () => {
  it("says up, down or flat, in symbols and in words, and nothing when there is no past to compare", () => {
    expect(deltaOf({ current: 5, previous: 4, changePct: 12 })).toEqual({ text: "▲ 12%", spoken: "up 12%", tone: "up" });
    expect(deltaOf({ current: 4, previous: 5, changePct: -20 })).toEqual({ text: "▼ 20%", spoken: "down 20%", tone: "down" });
    expect(deltaOf({ current: 4, previous: 4, changePct: 0 })?.tone).toBe("flat");
    expect(deltaOf({ current: 4, previous: 0, changePct: null })).toBeNull();
  });
  it("measures conversion in points", () => {
    expect(deltaOf({ current: 2.4, previous: 2.7, changePct: -11.1 }, "pts")).toEqual({ text: "▼ 0.3 pts", spoken: "down 0.3 pts", tone: "down" });
  });
  it("writes the headline from the revenue change", () => {
    expect(headline("Jetty", { current: 5, previous: 4, changePct: 18.4 })).toBe("Hey Jetty, sales are up 18.4%");
    expect(headline("Jetty", { current: 3, previous: 4, changePct: -25 })).toBe("Hey Jetty, sales are down 25%");
    expect(headline("Jetty", { current: 4, previous: 4, changePct: 0 })).toBe("Hey Jetty, sales are flat");
    expect(headline("Jetty", { current: 0, previous: 0, changePct: null })).toMatch(/how the shop is doing/);
  });
});

describe("chart", () => {
  const pts = (...v: number[]): RevenuePoint[] => v.map((revenueMinor, i) => ({ bucket: `2026-10-${String(i + 1).padStart(2, "0")}`, orders: 1, revenueMinor }));
  it("scales points across the box, the top at the maximum", () => {
    expect(linePoints([0, 50, 100], 100)).toBe("0.0,180.0 300.0,90.0 600.0,0.0");
    expect(linePoints([0, 0], 0)).toBe("0.0,180.0 600.0,180.0");
    expect(linePoints([], 10)).toBe("");
  });
  it("picks evenly spaced axis labels", () => {
    expect(axisTicks(pts(...Array(9).fill(1))).map((t) => t.label)).toEqual(["1 Oct", "3 Oct", "5 Oct", "7 Oct", "9 Oct"]);
    expect(axisTicks(pts(1, 2)).length).toBe(2);
  });
  it("summarises the chart in words, with the peak", () => {
    expect(chartSummary({ revenue: { current: 4_860_000_000, previous: 1, changePct: 18.4 }, phrase: "the previous 30 days", points: pts(100, 900, 300), interval: "day" })).toBe("Revenue ₦48.6M, up 18.4% on the previous 30 days; peak 2 Oct, ₦9");
  });
});

describe("funnel", () => {
  const steps = funnelSteps({ sessions: 1000, viewedProduct: 540, addedToBag: 120, checkout: 90, purchased: 40 });
  it("shows each step as a share of sessions", () => expect(steps.map((s) => s.pctOfSessions)).toEqual([100, 54, 12, 9, 4]));
  it("names the biggest drop only when one stands out", () => {
    expect(biggestDrop(steps)).toEqual({ from: "viewed product", to: "added to bag", lostPct: 78 });
    expect(biggestDrop(funnelSteps({ sessions: 1000, viewedProduct: 900, addedToBag: 800, checkout: 700, purchased: 600 }))).toBeNull();
    expect(biggestDrop(funnelSteps({ sessions: 10, viewedProduct: 1, addedToBag: 0, checkout: 0, purchased: 0 }))).toBeNull();
  });
});

it("tags campaigns by what they do", () => {
  expect([campaignTag("buy_x_get_y", false), campaignTag("percentage", true), campaignTag("free_gift", false), campaignTag("fixed_amount", true), campaignTag("fixed_amount", false)]).toEqual(["1+1", "%", "GIFT", "CODE", "SALE"]);
});
