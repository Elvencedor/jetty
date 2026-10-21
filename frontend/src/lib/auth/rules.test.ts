import { describe, expect, it } from "vitest";
import { cleanCode, emailError, identifierKind, passwordError, phoneError, safeNext, toIdentifier } from "./rules";

describe("field rules", () => {
  it("bounds passwords like the API", () => {
    expect(passwordError("short")).toMatch(/at least 10/);
    expect(passwordError("long enough pw")).toBeUndefined();
    expect(passwordError("x".repeat(129))).toMatch(/at most 128/);
  });
  it("checks phone and email", () => {
    expect(phoneError("0803 123 4567")).toBeUndefined();
    expect(phoneError("123")).toMatch(/Nigerian phone/);
    expect(emailError("ada@example.com")).toBeUndefined();
    expect(emailError("ada@")).toBe("Enter a valid email");
  });
  it("cleans a pasted code", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12-34-56-78")).toBe("123456");
    expect(cleanCode("abc")).toBe("");
  });
});

describe("toIdentifier", () => {
  it("tells email from phone and normalises each", () => {
    expect(identifierKind("a@b.co")).toBe("email");
    expect(toIdentifier(" Ada@Example.com ")).toEqual({ email: "ada@example.com" });
    expect(toIdentifier("08031234567")).toEqual({ phone: "+2348031234567" });
  });
  it("rejects what neither parses as", () => {
    expect(toIdentifier("nope")).toBeNull();
    expect(toIdentifier("a@")).toBeNull();
  });
});

describe("safeNext", () => {
  it("allows paths on this site", () => {
    expect(safeNext("/account/orders/123")).toBe("/account/orders/123");
    expect(safeNext("/checkout?step=payment")).toBe("/checkout?step=payment");
  });
  it("refuses anything that could leave the site, and loops back to sign-in", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil", "/a\nb", "/account/sign-in?next=/x", ""]) {
      expect(safeNext(bad)).toBe("/account");
    }
    expect(safeNext(null)).toBe("/account");
    expect(safeNext("x".repeat(400))).toBe("/account");
    expect(safeNext("//x", "/bag")).toBe("/bag");
  });
});
