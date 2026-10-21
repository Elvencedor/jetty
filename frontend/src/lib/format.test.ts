import { describe, expect, it } from "vitest";
import {
  describeDuration,
  formatDateTime,
  formatDay,
  formatDelta,
  formatDuration,
  formatEstimate,
  formatNaira,
  formatNairaCompact,
  formatNairaOff,
  formatPhone,
  formatRelativeOrAbsolute,
  lagosDateKey,
  maskPhone,
  normaliseNigerianPhone,
  timeAgo,
} from "./format";

describe("money", () => {
  it("shows whole naira without kobo and keeps kobo when there are any", () => {
    expect(formatNaira(20_300_000)).toBe("₦203,000");
    expect(formatNaira(250_050)).toBe("₦2,500.50");
    expect(formatNaira(0)).toBe("₦0");
    expect(formatNaira(5)).toBe("₦0.05");
    expect(formatNaira(20_300_000, { kobo: true })).toBe("₦203,000.00");
  });

  it("formats discounts with a real minus sign", () => {
    expect(formatNairaOff(11_795_000)).toBe("−₦117,950");
    expect(formatNairaOff(-11_795_000)).toBe("−₦117,950");
  });

  it("abbreviates for dashboards", () => {
    expect(formatNairaCompact(4_860_000_000)).toBe("₦48.6M");
    expect(formatNairaCompact(20_400_000)).toBe("₦204k");
    expect(formatNairaCompact(150_000)).toBe("₦1.5k");
    expect(formatNairaCompact(95_000)).toBe("₦950");
    expect(formatNairaCompact(200_000_000_000)).toBe("₦2B");
    expect(formatNairaCompact(100_000_000)).toBe("₦1M");
    expect(formatNairaCompact(-4_860_000_000)).toBe("−₦48.6M");
    expect(formatNairaCompact(0)).toBe("₦0");
  });
});

describe("Nigerian phone numbers", () => {
  it.each([
    ["0803 123 4567", "+2348031234567"],
    ["08031234567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["234-803-123-4567", "+2348031234567"],
    ["(0803) 123 4567", "+2348031234567"],
    ["803 123 4567", "+2348031234567"],
    ["0701 234 5678", "+2347012345678"],
    ["0901 234 5678", "+2349012345678"],
  ])("normalises %s", (input, expected) => {
    expect(normaliseNigerianPhone(input)).toBe(expected);
  });

  it.each(["", "080312345", "0803123456789", "0603 123 4567", "+1 415 555 2671", "abcdefghijk", "+234 603 123 4567"])("rejects %j", (input) => {
    expect(normaliseNigerianPhone(input)).toBeNull();
  });

  it("formats and masks for display, and leaves foreign numbers alone", () => {
    expect(formatPhone("+2348031234567")).toBe("0803 123 4567");
    expect(maskPhone("+2348031234567")).toBe("0803 ••• 4567");
    expect(formatPhone("+14155552671")).toBe("+14155552671");
    expect(maskPhone("+14155552671")).toBe("+14155552671");
  });
});

describe("Lagos time", () => {
  // 2026-10-19 22:30 UTC is already 23:30 on the 19th in Lagos; 23:30 UTC is 00:30 on the 20th.
  it("works out the Lagos calendar date, not the UTC one", () => {
    expect(lagosDateKey(new Date("2026-10-19T22:30:00Z"))).toBe("2026-10-19");
    expect(lagosDateKey(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
  });

  it("shows a date and time in WAT", () => {
    expect(formatDateTime("2026-10-10T13:05:00Z")).toBe("Oct 10, 14:05");
    expect(formatDateTime("2026-10-10T23:59:00Z")).toBe("Oct 11, 00:59");
  });

  it("is relative within a day and absolute after that", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(formatRelativeOrAbsolute("2026-10-10T11:59:40Z", now)).toBe("just now");
    expect(formatRelativeOrAbsolute("2026-10-10T11:48:00Z", now)).toBe("12 min ago");
    expect(formatRelativeOrAbsolute("2026-10-10T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelativeOrAbsolute("2026-10-10T07:00:00Z", now)).toBe("5 hours ago");
    expect(formatRelativeOrAbsolute("2026-10-09T11:00:00Z", now)).toBe("Oct 9, 12:00");
    expect(formatRelativeOrAbsolute("2026-10-10T12:30:00Z", now)).toBe("Oct 10, 13:30");
  });

  it("names days relative to today in Lagos", () => {
    const now = new Date("2026-10-19T23:30:00Z"); // 20 Oct in Lagos
    expect(formatDay("2026-10-20", now)).toBe("Today");
    expect(formatDay("2026-10-21", now)).toBe("Tomorrow");
    expect(formatDay("2026-10-24", now)).toBe("Sat 24 Oct");
    expect(formatEstimate({ earliestDate: "2026-10-21", latestDate: "2026-10-21" }, now)).toBe("Tomorrow");
    expect(formatEstimate({ earliestDate: "2026-10-22", latestDate: "2026-10-24" }, now)).toBe("Thu 22 Oct – Sat 24 Oct");
  });
});

describe("durations and deltas", () => {
  it("formats compact and spoken durations", () => {
    expect(formatDuration(3 * 3600_000 + 20 * 60_000 + 5_000)).toBe("3h 20m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(-5)).toBe("0s");
    expect(describeDuration(3 * 3600_000 + 41 * 60_000)).toBe("3 hours 41 minutes");
    expect(describeDuration(3600_000)).toBe("1 hour");
    expect(describeDuration(60_000)).toBe("1 minute");
    expect(describeDuration(5_000)).toBe("5 seconds");
  });

  it("signs percentage changes and hides a missing baseline", () => {
    expect(formatDelta(18.4)).toBe("+18.4%");
    expect(formatDelta(-3)).toBe("−3%");
    expect(formatDelta(0)).toBe("0%");
    expect(formatDelta(null)).toBeNull();
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  it("speaks in days, weeks and months, then gives the month", () => {
    expect(timeAgo(ago(0), now)).toBe("today");
    expect(timeAgo(ago(1), now)).toBe("yesterday");
    expect(timeAgo(ago(3), now)).toBe("3 days ago");
    expect(timeAgo(ago(7), now)).toBe("1 wk ago");
    expect(timeAgo(ago(15), now)).toBe("2 wks ago");
    expect(timeAgo(ago(95), now)).toBe("3 mo ago");
    expect(timeAgo(ago(500), now)).toBe("Jun 2025");
  });
});
