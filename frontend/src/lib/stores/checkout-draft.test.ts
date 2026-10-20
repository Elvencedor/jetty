import { beforeEach, describe, expect, it } from "vitest";
import { useCheckoutDraft } from "./checkout-draft";

beforeEach(() => {
  sessionStorage.clear();
  useCheckoutDraft.getState().reset();
});

describe("checkout draft", () => {
  it("keeps what was typed across a reload, in session storage only", async () => {
    useCheckoutDraft.getState().setDetails({ name: "Ada", state: "Lagos" });
    useCheckoutDraft.getState().setDeliveryMethod("same_day");
    expect(sessionStorage.getItem("jh.checkout-draft.v1")).toContain("Ada");
    expect(localStorage.getItem("jh.checkout-draft.v1")).toBeNull();
    // A fresh page load: the store starts empty, storage still has what was saved.
    const saved = sessionStorage.getItem("jh.checkout-draft.v1")!;
    useCheckoutDraft.setState({ details: { ...useCheckoutDraft.getState().details, name: "" }, deliveryMethod: null });
    sessionStorage.setItem("jh.checkout-draft.v1", saved);
    await useCheckoutDraft.persist.rehydrate();
    expect(useCheckoutDraft.getState().details.name).toBe("Ada");
    expect(useCheckoutDraft.getState().deliveryMethod).toBe("same_day");
  });

  it("drops anything unexpected from storage", async () => {
    sessionStorage.setItem("jh.checkout-draft.v1", JSON.stringify({ state: { details: { name: 5, phone: "0803", evil: "x" }, deliveryMethod: "teleport", paymentMethod: "cash", submission: { key: 1 } }, version: 1 }));
    await useCheckoutDraft.persist.rehydrate();
    const s = useCheckoutDraft.getState();
    expect(s.details.name).toBe("");
    expect(s.details.phone).toBe("0803");
    expect(s.details).not.toHaveProperty("evil");
    expect([s.deliveryMethod, s.paymentMethod, s.submission]).toEqual([null, null, null]);
  });

  it("is emptied by reset, as after an order is placed", () => {
    useCheckoutDraft.getState().setDetails({ phone: "0803" });
    useCheckoutDraft.getState().setSubmission({ key: "k", fingerprint: "f" });
    useCheckoutDraft.getState().reset();
    expect(useCheckoutDraft.getState().details.phone).toBe("");
    expect(useCheckoutDraft.getState().submission).toBeNull();
  });
});
