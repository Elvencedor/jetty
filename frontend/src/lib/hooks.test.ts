import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRange, useCursorStack } from "@/lib/admin/useCursorStack";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";
import { useCooldown } from "@/lib/auth/useCooldown";
import { openPaystack } from "@/lib/payments/paystack";
import { absoluteUrl, SITE_URL } from "@/lib/site";

describe("useCooldown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts down in whole seconds and stops at zero", () => {
    const { result } = renderHook(() => useCooldown());
    expect(result.current.left).toBe(0);
    act(() => result.current.start(3));
    expect(result.current.left).toBe(3);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.left).toBe(2);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.left).toBe(0);
  });
  it("restarts from a new duration", () => {
    const { result } = renderHook(() => useCooldown());
    act(() => result.current.start(30));
    act(() => void vi.advanceTimersByTime(10_000));
    act(() => result.current.start(60));
    expect(result.current.left).toBe(60);
  });
  it("rounds partial seconds up, so it never shows zero while still waiting", () => {
    const { result } = renderHook(() => useCooldown());
    act(() => result.current.start(1.2));
    expect(result.current.left).toBe(2);
  });
  it("stops its timer on unmount", () => {
    const { result, unmount } = renderHook(() => useCooldown());
    act(() => result.current.start(10));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useCursorStack", () => {
  it("starts on the first page with nothing to go back to", () => {
    const { result } = renderHook(() => useCursorStack());
    expect(result.current).toMatchObject({ cursor: undefined, index: 0, canPrev: false });
  });
  it("steps forward through cursors and back again", () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.next("c1"));
    act(() => result.current.next("c2"));
    expect(result.current).toMatchObject({ cursor: "c2", index: 2, canPrev: true });
    act(() => result.current.prev());
    expect(result.current.cursor).toBe("c1");
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ cursor: undefined, canPrev: false });
  });
  it("cannot step back past the first page", () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.prev());
    expect(result.current.index).toBe(0);
  });
  it("resets to the first page when filters change", () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.next("c1"));
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ cursor: undefined, index: 0 });
  });
});

describe("pageRange", () => {
  it("gives the 1-based range for 'Showing 9–16 of 40'", () => {
    expect(pageRange(0, 8, 8)).toEqual({ from: 1, to: 8 });
    expect(pageRange(1, 8, 8)).toEqual({ from: 9, to: 16 });
    expect(pageRange(2, 8, 3)).toEqual({ from: 17, to: 19 });
  });
  it("is 0–0 for an empty page", () => {
    expect(pageRange(0, 8, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("useUnsavedGuard", () => {
  const fire = () => {
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    return event;
  };
  it("asks before leaving while there are unsaved changes", () => {
    renderHook(() => useUnsavedGuard(true));
    expect(fire().defaultPrevented).toBe(true);
  });
  it("stays out of the way when clean", () => {
    renderHook(() => useUnsavedGuard(false));
    expect(fire().defaultPrevented).toBe(false);
  });
  it("stops guarding once saved or unmounted", () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedGuard(dirty), { initialProps: { dirty: true } });
    rerender({ dirty: false });
    expect(fire().defaultPrevented).toBe(false);
    rerender({ dirty: true });
    unmount();
    expect(fire().defaultPrevented).toBe(false);
  });
});

describe("site URLs", () => {
  it("builds absolute URLs without doubled slashes", () => {
    expect(absoluteUrl("/shop")).toBe(`${SITE_URL}/shop`);
    expect(absoluteUrl("shop")).toBe(`${SITE_URL}/shop`);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});

describe("openPaystack", () => {
  type Callbacks = { onSuccess: (tx: { reference: string }) => void; onCancel: () => void; onError: (e: { message: string }) => void };
  const mockPopup = (run: (cb: Callbacks, accessCode: string) => void) =>
    vi.doMock("@paystack/inline-js", () => ({ default: class { resumeTransaction(code: string, cb: Callbacks) { run(cb, code); } } }));
  afterEach(() => {
    vi.doUnmock("@paystack/inline-js");
    vi.resetModules();
  });

  it("resolves with the reference when the shopper finishes", async () => {
    const seen: string[] = [];
    mockPopup((cb, code) => (seen.push(code), cb.onSuccess({ reference: "ref_1" })));
    const { openPaystack: open } = await import("@/lib/payments/paystack");
    expect(await open("access-1")).toEqual({ kind: "success", reference: "ref_1" });
    expect(seen).toEqual(["access-1"]);
  });
  it("resolves as cancelled when the shopper closes the window", async () => {
    mockPopup((cb) => cb.onCancel());
    const { openPaystack: open } = await import("@/lib/payments/paystack");
    expect(await open("a")).toEqual({ kind: "cancelled" });
  });
  it("reports popup errors, with a fallback message", async () => {
    mockPopup((cb) => cb.onError({ message: "Card declined" }));
    const { openPaystack: open } = await import("@/lib/payments/paystack");
    expect(await open("a")).toEqual({ kind: "error", message: "Card declined" });
    vi.resetModules();
    mockPopup((cb) => cb.onError({ message: "" }));
    const again = await import("@/lib/payments/paystack");
    expect(await again.openPaystack("a")).toEqual({ kind: "error", message: "The payment window had a problem." });
  });
  it("reports a friendly error when the library cannot load", async () => {
    vi.doMock("@paystack/inline-js", () => {
      throw new Error("chunk failed");
    });
    const { openPaystack: open } = await import("@/lib/payments/paystack");
    const result = await open("a");
    expect(result.kind).toBe("error");
  });
  it("exports the function", () => {
    expect(typeof openPaystack).toBe("function");
  });
});
