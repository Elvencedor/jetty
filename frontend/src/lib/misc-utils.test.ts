import { afterEach, describe, expect, it, vi } from "vitest";
import { currentTime } from "./clock";
import { cn } from "./cn";
import { NIGERIAN_STATES } from "./geo/states";
import { reportError, setErrorReporter } from "./monitoring";

describe("cn", () => {
  it("joins truthy class names and skips falsy ones", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cn()).toBe("");
    expect(cn("a", 1 > 2 && "b")).toBe("a");
  });
});

describe("currentTime", () => {
  it("reads the clock, so tests can control it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    expect(currentTime()).toBe(Date.parse("2026-06-01T00:00:00Z"));
    vi.useRealTimers();
  });
});

describe("NIGERIAN_STATES", () => {
  it("lists 36 states plus the FCT, once each", () => {
    expect(NIGERIAN_STATES).toHaveLength(37);
    expect(new Set(NIGERIAN_STATES).size).toBe(37);
    expect(NIGERIAN_STATES).toContain("Lagos");
    expect(NIGERIAN_STATES).toContain("FCT");
  });
  it("is alphabetical apart from FCT's position", () => {
    const withoutFct = NIGERIAN_STATES.filter((s) => s !== "FCT");
    expect([...withoutFct].sort((a, b) => a.localeCompare(b))).toEqual(withoutFct);
  });
});

describe("monitoring", () => {
  afterEach(() => setErrorReporter((error, context) => console.error(`[${context.source}]`, error, context)));

  it("logs to the console by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = new Error("x");
    reportError(err, { source: "checkout" });
    expect(spy).toHaveBeenCalledWith("[checkout]", err, { source: "checkout" });
  });
  it("hands errors to a replacement reporter", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    reportError("oops", { source: "a", extra: 1 });
    expect(reporter).toHaveBeenCalledWith("oops", { source: "a", extra: 1 });
  });
  it("never throws, even when the reporter does", () => {
    setErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => reportError(new Error("x"), { source: "a" })).not.toThrow();
  });
});
