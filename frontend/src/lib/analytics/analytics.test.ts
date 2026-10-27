import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, resetAnalyticsQueue, track } from "./index";
import { SESSION_IDLE_MS, touchIdentity, useAnalyticsIdentity } from "./identity";
import { useConsent } from "@/lib/stores/consent";

const mock = vi.hoisted(() => ({ sent: [] as { path: string; body: { events: Record<string, unknown>[] } }[], failNext: false }));
const sent = mock.sent;
vi.mock("@/lib/api/client", () => ({
  // A plain function, not vi.fn(): the config restores mocks between tests, which would wipe a vi.fn implementation.
  apiFetch: async (path: string, options: { body: { events: Record<string, unknown>[] } }) => {
    if (mock.failNext) {
      mock.failNext = false;
      throw new Error("offline");
    }
    mock.sent.push({ path, body: options.body });
    return null;
  },
  apiUrl: (path: string) => `http://api.test/api/v1${path}`,
}));

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  // Most tests are about what is sent once the visitor has agreed.
  useConsent.setState({ analytics: "granted" });
});
afterEach(() => {
  vi.useRealTimers();
  resetAnalyticsQueue();
});

describe("analytics identity", () => {
  it("creates a visitor id once and keeps a session for 30 minutes of activity", () => {
    const first = touchIdentity(1_000);
    expect(first.isNewSession).toBe(true);
    const again = touchIdentity(1_000 + SESSION_IDLE_MS - 1);
    expect([again.anonymousId, again.sessionId, again.isNewSession]).toEqual([first.anonymousId, first.sessionId, false]);
    // Activity extends the session: another 29 minutes later it is still the same visit.
    expect(touchIdentity(1_000 + 2 * SESSION_IDLE_MS - 2).sessionId).toBe(first.sessionId);
  });

  it("starts a new session after being idle, with the same visitor id", () => {
    const first = touchIdentity(0);
    const later = touchIdentity(SESSION_IDLE_MS + 1);
    expect(later.isNewSession).toBe(true);
    expect(later.sessionId).not.toBe(first.sessionId);
    expect(later.anonymousId).toBe(first.anonymousId);
  });

  it("rewrites storage at most once a minute while the visit continues", () => {
    const first = touchIdentity(10_000);
    const written = () => useAnalyticsIdentity.getState().session!.lastActiveAt;
    expect(written()).toBe(10_000);
    touchIdentity(30_000);
    touchIdentity(60_000);
    expect(written()).toBe(10_000);
    const later = touchIdentity(70_000);
    expect(written()).toBe(70_000);
    expect([later.sessionId, later.isNewSession]).toEqual([first.sessionId, false]);
  });

  it("persists across page loads", () => {
    const { anonymousId } = touchIdentity();
    expect(JSON.parse(window.localStorage.getItem("jh.analytics.v1")!).state.anonymousId).toBe(anonymousId);
  });

  it("uses ids the API accepts", () => {
    const { anonymousId, sessionId } = touchIdentity();
    for (const id of [anonymousId, sessionId]) expect(id).toMatch(/^[\w-]{8,64}$/);
    expect(useAnalyticsIdentity.getState().session?.id).toBe(sessionId);
  });
});

describe("tracking", () => {
  it("batches events and sends them in the background, opening the visit first", async () => {
    track("product_view", { productId: "p1" });
    track("add_to_bag", { variantId: "v1", quantity: 2 });
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2100);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe("/analytics/events");
    expect(sent[0]!.body.events.map((e) => e.name)).toEqual(["session_start", "product_view", "add_to_bag"]);
    expect(sent[0]!.body.events[1]).toMatchObject({ properties: { productId: "p1" } });
    expect(new Set(sent[0]!.body.events.map((e) => e.sessionId)).size).toBe(1);
  });

  it("does not repeat session_start within the same visit", async () => {
    track("product_view");
    await vi.advanceTimersByTimeAsync(2100);
    track("product_view");
    await vi.advanceTimersByTimeAsync(2100);
    expect(sent.flatMap((s) => s.body.events).filter((e) => e.name === "session_start")).toHaveLength(1);
  });

  it("sends at once in batches of at most 20, the API's limit", async () => {
    for (let i = 0; i < 45; i++) track("product_view");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => s.body.events.length)).toEqual([20, 20]);
    await vi.advanceTimersByTimeAsync(2100);
    expect(sent.map((s) => s.body.events.length)).toEqual([20, 20, 6]);
  });

  it("uses sendBeacon when the page is going away", () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    track("checkout_start");
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("http://api.test/api/v1/analytics/events");
    expect(blob.type).toBe("application/json");
    expect(sent).toHaveLength(0);
  });

  it("never throws or retries when sending fails", async () => {
    mock.failNext = true;
    track("product_view");
    await expect(vi.advanceTimersByTimeAsync(2100)).resolves.not.toThrow();
    flush();
    expect(sent).toHaveLength(0);
  });

  it("does nothing on the server", () => {
    const original = globalThis.window;
    // @ts-expect-error simulating a server render
    delete globalThis.window;
    try {
      expect(() => track("product_view")).not.toThrow();
    } finally {
      globalThis.window = original;
    }
  });
});

describe("consent", () => {
  it("records and sends nothing until the visitor agrees, and not after they decline", () => {
    for (const choice of ["unset", "denied"] as const) {
      useConsent.setState({ analytics: choice });
      track("product_view", { productId: "p1" });
      flush();
      expect(sent).toHaveLength(0);
      expect(useAnalyticsIdentity.getState().anonymousId).toBeNull();
    }
  });

  it("sends once they agree", () => {
    useConsent.setState({ analytics: "granted" });
    track("product_view", { productId: "p1" });
    flush();
    expect(sent[0]!.body.events.map((e) => e.name)).toEqual(["session_start", "product_view"]);
  });
});
