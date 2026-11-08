import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_IDLE_MS, touchIdentity, useAnalyticsIdentity } from "@/lib/analytics/identity";
import { analyticsAllowed, useConsent } from "./consent";
import { usePaymentSession, type PendingPayment } from "./payment-session";
import { useAdminSession, useCustomerSession } from "./session";
import { useSessionHints } from "./session-hint";
import { toast, useToasts } from "./toast";
import { useUiPrefs } from "./ui-prefs";

describe("consent", () => {
  it("starts undecided, and nothing is allowed until the visitor says yes", () => {
    expect(useConsent.getState().analytics).toBe("unset");
    expect(analyticsAllowed()).toBe(false);
  });
  it("allows analytics only after 'granted'", () => {
    useConsent.getState().choose("granted");
    expect(analyticsAllowed()).toBe(true);
    useConsent.getState().choose("denied");
    expect(analyticsAllowed()).toBe(false);
  });
  it("can be reset to undecided", () => {
    useConsent.getState().choose("granted");
    useConsent.getState().reset();
    expect(useConsent.getState().analytics).toBe("unset");
  });
  it("remembers the choice across visits", () => {
    useConsent.getState().choose("granted");
    expect(JSON.parse(localStorage.getItem("jh.consent.v1")!).state).toEqual({ analytics: "granted" });
  });
  it("restores a valid saved choice and ignores junk", async () => {
    localStorage.setItem("jh.consent.v1", JSON.stringify({ state: { analytics: "denied" }, version: 1 }));
    await useConsent.persist.rehydrate();
    expect(useConsent.getState().analytics).toBe("denied");
    localStorage.setItem("jh.consent.v1", JSON.stringify({ state: { analytics: "maybe" }, version: 1 }));
    useConsent.setState({ analytics: "unset" });
    await useConsent.persist.rehydrate();
    expect(useConsent.getState().analytics).toBe("unset");
  });
});

describe("toasts", () => {
  beforeEach(() => useToasts.setState({ toasts: [] }));

  it("adds a toast per tone and returns its id", () => {
    const a = toast.success("saved");
    const b = toast.error("failed");
    const c = toast.info("fyi");
    expect(new Set([a, b, c]).size).toBe(3);
    expect(useToasts.getState().toasts.map((t) => [t.tone, t.message])).toEqual([["success", "saved"], ["error", "failed"], ["info", "fyi"]]);
  });
  it("keeps only the latest four", () => {
    for (let i = 0; i < 6; i++) toast.info(`m${i}`);
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(["m2", "m3", "m4", "m5"]);
  });
  it("attaches an action only when given", () => {
    const onClick = vi.fn();
    toast.error("Could not save", { label: "Retry", onClick });
    toast.info("plain");
    const [withAction, plain] = useToasts.getState().toasts;
    expect(withAction!.action?.label).toBe("Retry");
    withAction!.action!.onClick();
    expect(onClick).toHaveBeenCalledOnce();
    expect("action" in plain!).toBe(false);
  });
  it("dismisses one toast by id and ignores unknown ids", () => {
    const a = toast.info("a");
    toast.info("b");
    useToasts.getState().dismiss(a);
    useToasts.getState().dismiss(99999);
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(["b"]);
  });
});

describe("sessions", () => {
  it("setSession authenticates and computes the expiry from expiresIn", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useCustomerSession.getState().setSession({ accessToken: "tok", expiresIn: 900, user: { id: "c1" } as never });
    const s = useCustomerSession.getState();
    expect([s.status, s.accessToken, s.expiresAt, s.user?.id]).toEqual(["authenticated", "tok", 1_000_000 + 900_000, "c1"]);
    vi.useRealTimers();
  });
  it("clear marks the visitor anonymous (not unknown) and drops the token", () => {
    useCustomerSession.getState().setSession({ accessToken: "tok", expiresIn: 60, user: { id: "c1" } as never });
    useCustomerSession.getState().clear();
    expect(useCustomerSession.getState()).toMatchObject({ status: "anonymous", accessToken: null, expiresAt: null, user: null });
  });
  it("setUser replaces the profile without touching the token", () => {
    useCustomerSession.getState().setSession({ accessToken: "tok", expiresIn: 60, user: { id: "c1" } as never });
    useCustomerSession.getState().setUser({ id: "c2" } as never);
    expect(useCustomerSession.getState()).toMatchObject({ accessToken: "tok", user: { id: "c2" } });
  });
  it("keeps customer and admin sessions independent", () => {
    useAdminSession.getState().setSession({ accessToken: "admin-tok", expiresIn: 60, user: { id: "a1" } as never });
    expect(useCustomerSession.getState().status).toBe("unknown");
    useCustomerSession.getState().clear();
    expect(useAdminSession.getState().status).toBe("authenticated");
  });
  it("never writes a token to storage", () => {
    useCustomerSession.getState().setSession({ accessToken: "secret-token", expiresIn: 60, user: { id: "c1" } as never });
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain("secret-token");
  });
});

describe("session hints", () => {
  it("tracks customer and admin separately and persists them", () => {
    useSessionHints.getState().set("customer", true);
    expect(useSessionHints.getState()).toMatchObject({ customer: true, admin: false });
    expect(JSON.parse(localStorage.getItem("jh.session-hints.v1")!).state).toEqual({ customer: true, admin: false });
    useSessionHints.getState().set("customer", false);
    expect(useSessionHints.getState().customer).toBe(false);
  });
});

describe("ui prefs", () => {
  it("defaults to the grid view and remembers a change", () => {
    expect(useUiPrefs.getState().listView).toBe("grid");
    useUiPrefs.getState().setListView("list");
    expect(JSON.parse(localStorage.getItem("jh.ui-prefs.v1")!).state).toEqual({ listView: "list" });
  });
  it("restores only known views on hydration", async () => {
    localStorage.setItem("jh.ui-prefs.v1", JSON.stringify({ state: { listView: "list" }, version: 1 }));
    await useUiPrefs.persist.rehydrate();
    expect(useUiPrefs.getState().listView).toBe("list");
    useUiPrefs.setState({ listView: "grid" });
    localStorage.setItem("jh.ui-prefs.v1", JSON.stringify({ state: { listView: "carousel" }, version: 1 }));
    await useUiPrefs.persist.rehydrate();
    expect(useUiPrefs.getState().listView).toBe("grid");
  });
});

describe("payment session", () => {
  const valid: PendingPayment = { orderId: "o1", orderNumber: "JH-1", reference: "jh_ref", accessCode: "ac", amountMinor: 500000, reservationExpiresAt: "2026-06-01T10:00:00Z", method: "card", quotedMinor: 500000 };
  const store = (payment: unknown) => sessionStorage.setItem("jh.payment.v1", JSON.stringify({ state: { payment }, version: 1 }));
  beforeEach(() => usePaymentSession.setState({ payment: null }));

  it("keeps the payment in progress for the tab only (session storage)", () => {
    usePaymentSession.getState().set(valid);
    expect(JSON.parse(sessionStorage.getItem("jh.payment.v1")!).state.payment.reference).toBe("jh_ref");
    expect(localStorage.getItem("jh.payment.v1")).toBeNull();
  });
  it("can be cleared", () => {
    usePaymentSession.getState().set(valid);
    usePaymentSession.getState().set(null);
    expect(usePaymentSession.getState().payment).toBeNull();
  });
  it("restores a well-formed payment after a reload", async () => {
    store(valid);
    await usePaymentSession.persist.rehydrate();
    expect(usePaymentSession.getState().payment).toEqual(valid);
  });
  it("discards tampered or incomplete stored payments", async () => {
    for (const bad of [{ ...valid, method: "cash" }, { ...valid, amountMinor: 12.5 }, { ...valid, reference: "" }, { ...valid, accessCode: 5 }, { ...valid, orderId: "x".repeat(600) }, { ...valid, quotedMinor: "100" }, { orderId: "o" }, null, "junk"]) {
      usePaymentSession.setState({ payment: null });
      store(bad);
      await usePaymentSession.persist.rehydrate();
      expect(usePaymentSession.getState().payment, JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("analytics identity", () => {
  const T0 = 1_700_000_000_000;
  beforeEach(() => useAnalyticsIdentity.setState({ anonymousId: null, session: null }));

  it("creates a visitor id and a session on first touch", () => {
    const first = touchIdentity(T0);
    expect(first.isNewSession).toBe(true);
    expect(first.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.sessionId).not.toBe(first.anonymousId);
  });
  it("keeps the session within the idle window and reports it as not new", () => {
    const a = touchIdentity(T0);
    const b = touchIdentity(T0 + SESSION_IDLE_MS - 1);
    expect(b).toEqual({ ...a, isNewSession: false });
  });
  it("starts a new session after the idle window but keeps the visitor id", () => {
    const a = touchIdentity(T0);
    const b = touchIdentity(T0 + SESSION_IDLE_MS + 1);
    expect(b.isNewSession).toBe(true);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.anonymousId).toBe(a.anonymousId);
  });
  it("only rewrites the activity time about once a minute", () => {
    touchIdentity(T0);
    touchIdentity(T0 + 10_000);
    expect(useAnalyticsIdentity.getState().session!.lastActiveAt).toBe(T0);
    touchIdentity(T0 + 60_000);
    expect(useAnalyticsIdentity.getState().session!.lastActiveAt).toBe(T0 + 60_000);
  });
  it("lets activity extend a session beyond the idle window from its start", () => {
    const a = touchIdentity(T0);
    let t = T0;
    for (let i = 0; i < 5; i++) {
      t += 20 * 60_000;
      expect(touchIdentity(t).sessionId).toBe(a.sessionId);
    }
  });
});
