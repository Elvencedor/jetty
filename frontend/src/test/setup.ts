import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { useAnalyticsIdentity } from "@/lib/analytics/identity";
import { useCartStore } from "@/lib/stores/cart";
import { useConsent } from "@/lib/stores/consent";
import { useAdminSession, useCustomerSession } from "@/lib/stores/session";
import { useSessionHints } from "@/lib/stores/session-hint";
import { server } from "./server";

// jsdom has no modal <dialog>. This stand-in opens and closes it (and fires "close") so components that use one can be tested.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));

afterEach(async () => {
  cleanup();
  server.resetHandlers();
  // Imported lazily: a test file's vi.mock must be in place before this module (and the API client it uses) loads.
  (await import("@/lib/analytics")).resetAnalyticsQueue();
  // Every test starts signed out, with an empty bag and no stored state.
  useCustomerSession.setState({ status: "unknown", accessToken: null, expiresAt: null, user: null });
  useAdminSession.setState({ status: "unknown", accessToken: null, expiresAt: null, user: null });
  useCartStore.setState({ lines: [], promotionCodes: [] });
  useAnalyticsIdentity.setState({ anonymousId: null, session: null });
  useSessionHints.setState({ customer: false, admin: false });
  useConsent.setState({ analytics: "unset" });
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterAll(() => server.close());
