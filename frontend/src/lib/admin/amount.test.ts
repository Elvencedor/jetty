import { describe, expect, it } from "vitest";
import { formatAmountInput, minorToAmountText } from "./amount";
import { parseNairaToMinor } from "./orders";

describe("formatAmountInput", () => {
  it("separates thousands as the number grows", () => {
    expect(["1", "12", "123", "1234", "12345", "123456", "1234567"].map((v) => formatAmountInput(v))).toEqual(["1", "12", "123", "1,234", "12,345", "123,456", "1,234,567"]);
  });
  it("keeps kobo after a point, to two places, and a point just typed", () => {
    expect(formatAmountInput("1500.5")).toBe("1,500.5");
    expect(formatAmountInput("1500.567")).toBe("1,500.56");
    expect(formatAmountInput("1500.")).toBe("1,500.");
    expect(formatAmountInput(".5")).toBe(".5");
  });
  it("drops the point when only whole amounts are allowed", () => {
    expect(formatAmountInput("1500.50", { decimal: false })).toBe("150,050");
  });
  it("takes pasted text with symbols, spaces and commas", () => {
    expect(formatAmountInput("₦ 1,500,000 NGN")).toBe("1,500,000");
    expect(formatAmountInput("12,50,000")).toBe("1,250,000");
  });
  it("drops leading zeros but keeps a lone zero, and leaves an empty box empty", () => {
    expect([formatAmountInput("007"), formatAmountInput("0"), formatAmountInput(""), formatAmountInput("abc")]).toEqual(["7", "0", "", ""]);
  });
  it("keeps a sign only when a difference is being typed", () => {
    expect(formatAmountInput("-10000", { signed: true, decimal: false })).toBe("-10,000");
    expect(formatAmountInput("+25000", { signed: true, decimal: false })).toBe("+25,000");
    expect(formatAmountInput("-", { signed: true })).toBe("-");
    expect(formatAmountInput("-10000")).toBe("10,000");
  });
  it("is read back as the same amount by the parser", () => {
    expect(parseNairaToMinor(formatAmountInput("1234567.5"))).toBe(123456750);
  });
});

describe("minorToAmountText", () => {
  it("shows kobo as the naira text a box holds", () => {
    expect([minorToAmountText(150000), minorToAmountText(12500050), minorToAmountText(12500005), minorToAmountText(0), minorToAmountText(99), minorToAmountText(-200000)]).toEqual(["1,500", "125,000.5", "125,000.05", "0", "0.99", "-2,000"]);
  });
});
