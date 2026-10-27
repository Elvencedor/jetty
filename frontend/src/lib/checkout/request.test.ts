import { describe, expect, it } from "vitest";
import { buildCheckoutRequest, fingerprint, submissionFor } from "./request";
import { emptyDelivery, type DeliveryDetails } from "./validation";

const details = (over: Partial<DeliveryDetails> = {}): DeliveryDetails => ({ ...emptyDelivery(), name: " Ada Obi ", phone: "0803 123 4567", addressLine1: "12 Admiralty Way", city: "Lagos", state: "Lagos", ...over });
const input = (over = {}) => ({ lines: [{ variantId: "v1", quantity: 2 }], promotionCodes: ["SAVE10"], details: details(), deliveryMethod: "same_day" as const, paymentMethod: "card" as const, ...over });

describe("buildCheckoutRequest", () => {
  it("normalises the phone, trims text and leaves empty optional fields out", () => {
    const request = buildCheckoutRequest(input())!;
    expect(request.contact).toEqual({ phone: "+2348031234567" });
    expect(request.deliveryAddress).toEqual({ recipientName: "Ada Obi", addressLine1: "12 Admiralty Way", city: "Lagos", state: "Lagos", countryCode: "NG" });
    expect(request).toMatchObject({ items: [{ variantId: "v1", quantity: 2 }], promotionCodes: ["SAVE10"], deliveryMethod: "same_day", paymentMethod: "card", termsAccepted: true });
  });

  it("includes optional fields when given, lower-casing the email", () => {
    const request = buildCheckoutRequest(input({ details: details({ email: " Ada@Example.COM ", area: "Lekki", landmark: "Near the mall", riderNote: "Call me" }) }))!;
    expect(request.contact.email).toBe("ada@example.com");
    expect(request.deliveryAddress).toMatchObject({ area: "Lekki", landmark: "Near the mall", riderNote: "Call me" });
  });

  it("refuses to build without items or with an unusable phone", () => {
    expect(buildCheckoutRequest(input({ lines: [] }))).toBeNull();
    expect(buildCheckoutRequest(input({ details: details({ phone: "12345" }) }))).toBeNull();
  });

  it("sends only ids and quantities for items", () => {
    const request = buildCheckoutRequest(input({ lines: [{ variantId: "v1", quantity: 1, price: 5 }] as never }))!;
    expect(request.items).toEqual([{ variantId: "v1", quantity: 1 }]);
  });
});

describe("idempotency", () => {
  const request = buildCheckoutRequest(input())!;
  it("reuses the key for an identical request, however the keys are ordered", () => {
    const first = submissionFor(request, null, () => "key-1");
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(request).reverse()))) as typeof request;
    expect(fingerprint(reordered)).toBe(fingerprint(request));
    expect(submissionFor(reordered, first, () => "key-2")).toBe(first);
  });

  it("makes a new key when anything the server would see has changed", () => {
    const first = submissionFor(request, null, () => "key-1");
    const changed = buildCheckoutRequest(input({ paymentMethod: "bank_transfer" }))!;
    expect(submissionFor(changed, first, () => "key-2").key).toBe("key-2");
    const moreOfIt = buildCheckoutRequest(input({ lines: [{ variantId: "v1", quantity: 3 }] }))!;
    expect(submissionFor(moreOfIt, first, () => "key-3").key).toBe("key-3");
  });

  it("makes UUID-shaped keys long enough for guests", async () => {
    const { newIdempotencyKey } = await import("./request");
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
