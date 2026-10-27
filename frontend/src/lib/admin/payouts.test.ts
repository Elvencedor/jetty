import { describe, expect, it } from "vitest";
import { accountDigits, isAccountNumber, maskedAccount, validatePayout } from "./payouts";

describe("payout account helpers", () => {
  it("knows a ten-digit account number, ignoring spaces", () => {
    expect([isAccountNumber("0123456789"), isAccountNumber("012 345 6789"), isAccountNumber("012345678"), isAccountNumber("01234567890"), isAccountNumber("01234abcde")]).toEqual([true, true, false, false, false]);
  });
  it("keeps only digits, at most ten, as it is typed", () => expect(accountDigits("01-23 45a6789012")).toBe("0123456789"));
  it("shows only the last four digits", () => expect(maskedAccount("GTBank", "6789")).toBe("GTBank ••••6789"));
  it("asks for what is missing", () => {
    expect(validatePayout({ businessName: "J", bankCode: "", accountNumber: "12" })).toEqual({ businessName: "Enter the name customers know the business by", bankCode: "Choose the bank", accountNumber: "Enter the 10-digit account number" });
    expect(validatePayout({ businessName: "Jetty", bankCode: "058", accountNumber: "0123456789" })).toEqual({});
  });
});
