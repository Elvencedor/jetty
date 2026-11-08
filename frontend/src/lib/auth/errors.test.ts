import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { authErrorMessage } from "./errors";
import { interpretCheckoutError } from "@/lib/checkout/errors";

const api = (status: number, code: string, message = "server says", extra: { details?: unknown[]; retryAfter?: number } = {}) =>
  new ApiError(status, { code, message, requestId: "req_1", ...(extra.details ? { details: extra.details } : {}) }, extra.retryAfter);

describe("authErrorMessage", () => {
  it("gives a generic message for non-API errors", () => {
    expect(authErrorMessage(new Error("boom"), "password")).toBe("Something went wrong. Please try again.");
    expect(authErrorMessage("x", "code")).toBe("Something went wrong. Please try again.");
  });
  it("does not reveal whether an account exists on a bad login", () => {
    expect(authErrorMessage(api(401, "INVALID_CREDENTIALS"), "password")).toBe("That email or password isn't right.");
  });
  it("words an invalid code differently when resetting a password", () => {
    expect(authErrorMessage(api(422, "INVALID_CODE"), "reset")).toMatch(/Request a new one/);
    expect(authErrorMessage(api(422, "INVALID_CODE"), "code")).not.toMatch(/Request a new one/);
  });
  it("points an existing account at sign-in", () => {
    expect(authErrorMessage(api(409, "ACCOUNT_EXISTS"), "register")).toMatch(/Try signing in/);
  });
  it("tells the shopper how long to wait when rate limited, defaulting to 60s", () => {
    expect(authErrorMessage(api(429, "RATE_LIMITED", "x", { retryAfter: 17 }), "password")).toMatch(/17 seconds/);
    expect(authErrorMessage(api(429, "RATE_LIMITED"), "password")).toMatch(/60 seconds/);
  });
  it("maps validation and availability errors", () => {
    expect(authErrorMessage(api(422, "VALIDATION_FAILED"), "register")).toMatch(/check the details/);
    expect(authErrorMessage(api(503, "AUTH_UNAVAILABLE"), "password")).toMatch(/unavailable/);
  });
  it("blames the connection for other retryable failures", () => {
    expect(authErrorMessage(api(500, "INTERNAL_ERROR"), "password")).toMatch(/connection/);
    expect(authErrorMessage(api(0, "NETWORK_ERROR"), "password")).toMatch(/connection/);
  });
  it("falls back to a code-sending message, or the server's own", () => {
    expect(authErrorMessage(api(400, "SOMETHING_ELSE"), "request")).toBe("We couldn't send a code. Please try again.");
    expect(authErrorMessage(api(400, "SOMETHING_ELSE", "Custom text"), "password")).toBe("Custom text");
  });
});

describe("interpretCheckoutError", () => {
  it("treats unknown errors as a generic failure", () => {
    expect(interpretCheckoutError(new Error("x"))).toEqual({ kind: "other", message: "Something went wrong. Please try again." });
  });
  it("recognises stock problems", () => {
    for (const code of ["OUT_OF_STOCK", "VARIANT_UNAVAILABLE"]) expect(interpretCheckoutError(api(409, code)).kind).toBe("stock");
  });
  it("recognises offers, delivery and payment method problems", () => {
    expect(interpretCheckoutError(api(422, "PROMOTION_UNAVAILABLE")).kind).toBe("offer");
    expect(interpretCheckoutError(api(422, "DELIVERY_UNAVAILABLE")).kind).toBe("delivery");
    expect(interpretCheckoutError(api(422, "DELIVERY_METHOD_UNAVAILABLE")).kind).toBe("delivery");
    expect(interpretCheckoutError(api(422, "PAYMENT_METHOD_UNAVAILABLE")).kind).toBe("method");
  });
  it("carries the order id when payment could not start, so the shopper can retry that order", () => {
    const f = interpretCheckoutError(api(502, "PAYMENT_INITIALIZATION_FAILED", "x", { details: [{ other: 1 }, { orderId: "o-9" }] }));
    expect(f).toMatchObject({ kind: "payment-start", orderId: "o-9" });
    expect(interpretCheckoutError(api(502, "PAYMENT_INITIALIZATION_PENDING")).kind).toBe("payment-start");
    expect(interpretCheckoutError(api(502, "PAYMENT_INITIALIZATION_FAILED"))).toMatchObject({ orderId: undefined });
    expect(interpretCheckoutError(api(502, "PAYMENT_INITIALIZATION_FAILED", "x", { details: [{ orderId: 5 }] }))).toMatchObject({ orderId: undefined });
  });
  it("reports an in-flight duplicate as busy", () => {
    expect(interpretCheckoutError(api(409, "IDEMPOTENCY_IN_PROGRESS")).kind).toBe("busy");
  });
  it("maps field errors by field name, ignoring malformed details", () => {
    const f = interpretCheckoutError(api(422, "VALIDATION_FAILED", "x", { details: [{ field: "phone", message: "Bad phone" }, { field: "email" }, { message: "orphan" }, null as never] }));
    expect(f).toEqual({ kind: "fields", message: "Please check the details you entered.", fields: { phone: "Bad phone" } });
  });
  it("handles rate limits and connection trouble as retryable", () => {
    expect(interpretCheckoutError(api(429, "RATE_LIMITED", "x", { retryAfter: 5 }))).toMatchObject({ kind: "retry", message: expect.stringContaining("5 seconds") });
    expect(interpretCheckoutError(api(503, "DOWN")).kind).toBe("retry");
  });
  it("surfaces the server's message for anything else", () => {
    expect(interpretCheckoutError(api(400, "WEIRD", "Specific problem"))).toEqual({ kind: "other", message: "Specific problem" });
  });
});
