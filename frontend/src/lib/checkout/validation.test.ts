import { describe, expect, it } from "vitest";
import { emptyDelivery, firstInvalid, validateDelivery, validateField } from "./validation";

const valid = () => ({ ...emptyDelivery(), name: "Ada Obi", phone: "08031234567", addressLine1: "12 Admiralty Way", city: "Lekki", state: "Lagos" });

describe("validateField", () => {
  it("accepts the phone formats Nigerians type and rejects the rest", () => {
    for (const ok of ["0803 123 4567", "+234 803 123 4567", "2348031234567", "803-123-4567"]) expect(validateField("phone", ok)).toBeUndefined();
    expect(validateField("phone", "0123456789")).toMatch(/Nigerian phone number/);
    expect(validateField("phone", "")).toMatch(/Nigerian phone number/);
  });
  it("treats email as optional but checks it when given", () => {
    expect(validateField("email", "")).toBeUndefined();
    expect(validateField("email", "ada@example.com")).toBeUndefined();
    expect(validateField("email", "ada@")).toBe("Enter a valid email");
  });
  it("needs a real state from the list", () => {
    expect(validateField("state", "Lagos")).toBeUndefined();
    expect(validateField("state", "Atlantis")).toBe("Choose your state");
    expect(validateField("state", "")).toBe("Choose your state");
  });
  it("bounds free text the way the API does", () => {
    expect(validateField("name", " A ")).toBe("Enter your full name");
    expect(validateField("addressLine1", "x".repeat(201))).toBe("Enter your street address");
    expect(validateField("landmark", "x".repeat(201))).toMatch(/under 200/);
    expect(validateField("riderNote", "x".repeat(301))).toMatch(/under 300/);
  });
});

describe("validateDelivery", () => {
  it("passes complete details", () => expect(validateDelivery(valid())).toEqual({}));
  it("reports every problem and finds the first in screen order", () => {
    const errors = validateDelivery(emptyDelivery());
    expect(Object.keys(errors)).toEqual(["name", "phone", "addressLine1", "city", "state"]);
    expect(firstInvalid(errors)).toBe("name");
    expect(firstInvalid({})).toBeUndefined();
    expect(firstInvalid({ state: "x", phone: "y" })).toBe("phone");
  });
});
