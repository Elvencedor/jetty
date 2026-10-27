import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomerSession } from "@/lib/stores/session";
import { useSessionHints } from "@/lib/stores/session-hint";
import { REFRESH_LEAD_MS, RETRY_MS, startSession } from "./bootstrap";

const refresh = vi.hoisted(() => vi.fn<(kind: string) => Promise<string | null>>());
vi.mock("@/lib/api/client", () => ({ refreshAccessToken: refresh }));

const customer = { id: "c1", phone: "+2348031234567", email: null, emailVerified: false, phoneVerified: true, createdAt: "2026-01-01T00:00:00Z" };
const store = () => useCustomerSession.getState();
/** What a successful refresh does to the store. */
const grants = (token: string, expiresIn = 900) => async () => {
  store().setSession({ accessToken: token, expiresIn, user: customer });
  return token;
};
let stop: (() => void) | undefined;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe("customer session bootstrap", () => {
  it("does not call the server for a browser that has never been signed in", async () => {
    stop = startSession("customer");
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(store().status).toBe("anonymous");
  });

  it("restores a returning customer, then renews the token just before it expires, repeatedly", async () => {
    useSessionHints.setState({ customer: true });
    refresh.mockImplementation(grants("t1"));
    stop = startSession("customer");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store()).toMatchObject({ status: "authenticated", accessToken: "t1" });

    refresh.mockImplementation(grants("t2"));
    await vi.advanceTimersByTimeAsync(900_000 - REFRESH_LEAD_MS - 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(store().accessToken).toBe("t2");

    refresh.mockImplementation(grants("t3"));
    await vi.advanceTimersByTimeAsync(900_000 - REFRESH_LEAD_MS + 1000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("starts renewing when someone signs in later, and remembers the browser as signed in", async () => {
    stop = startSession("customer");
    await flush();
    store().setSession({ accessToken: "fresh", expiresIn: 900, user: customer });
    expect(useSessionHints.getState().customer).toBe(true);
    refresh.mockImplementation(grants("renewed"));
    await vi.advanceTimersByTimeAsync(900_000 - REFRESH_LEAD_MS + 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store().accessToken).toBe("renewed");
  });

  it("forgets the browser and stops when the server rejects the session", async () => {
    useSessionHints.setState({ customer: true });
    refresh.mockImplementation(async () => {
      store().clear();
      return null;
    });
    stop = startSession("customer");
    await flush();
    expect(store().status).toBe("anonymous");
    expect(useSessionHints.getState().customer).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps trying when the server cannot be reached, without signing anyone out", async () => {
    useSessionHints.setState({ customer: true });
    refresh.mockResolvedValueOnce(null).mockImplementation(grants("back"));
    stop = startSession("customer");
    await flush();
    expect(store().status).toBe("unknown");
    expect(useSessionHints.getState().customer).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS + 100);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(store().status).toBe("authenticated");
  });

  it("retries soon when a renewal fails because the server cannot be reached, instead of letting the token lapse", async () => {
    useSessionHints.setState({ customer: true });
    refresh.mockImplementation(grants("t1"));
    stop = startSession("customer");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockReset();
    refresh.mockResolvedValueOnce(null).mockImplementation(grants("t2"));
    await vi.advanceTimersByTimeAsync(900_000 - REFRESH_LEAD_MS + 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store().accessToken).toBe("t1");
    await vi.advanceTimersByTimeAsync(RETRY_MS + 100);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(store().accessToken).toBe("t2");
  });

  it("renews as soon as a sleeping tab wakes with a token about to lapse", async () => {
    useSessionHints.setState({ customer: true });
    refresh.mockImplementation(grants("t1"));
    stop = startSession("customer");
    await flush();
    refresh.mockClear();
    useCustomerSession.setState({ expiresAt: Date.now() + 10_000 });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops cleanly", async () => {
    useSessionHints.setState({ customer: true });
    refresh.mockImplementation(grants("t1"));
    const stopNow = startSession("customer");
    await flush();
    stopNow();
    await vi.advanceTimersByTimeAsync(2 * 900_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
