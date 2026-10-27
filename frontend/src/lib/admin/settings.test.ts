import { describe, expect, it } from "vitest";
import type { DeliveryZone } from "@/lib/api/admin-settings";
import { missingStoreDetails, canSwitchOff, changedFields, cutoffLabel, holdChoices, parseAreas, returnWindowChoices, storeToForm, storeToSettings, validateStore, validateZone, zoneOptions, zoneToForm, zoneToInput } from "./settings";

describe("changedFields", () => {
  it("returns only what differs, and null when nothing does", () => {
    expect(changedFields({ a: 1, b: [1, 2], c: "x" }, { a: 1, b: [1, 3], c: "x" })).toEqual({ b: [1, 3] });
    expect(changedFields({ a: 1 }, { a: 1 })).toBeNull();
  });
});

describe("store details", () => {
  const stored = { name: "Jetty's Hair", contactEmail: "hello@example.com", contactPhone: "+2348031234567", whatsappNumber: "", showroomAddress: " Lekki ", showroomHours: "" };
  it("shows phone numbers as people write them, and stores them in E.164", () => {
    const form = storeToForm(stored);
    expect(form.contactPhone).toBe("0803 123 4567");
    expect(storeToSettings({ ...form, contactPhone: "0803 123 4567", whatsappNumber: "+14155550123" })).toMatchObject({ contactPhone: "+2348031234567", whatsappNumber: "+14155550123", showroomAddress: "Lekki" });
  });
  it("asks for a name, a sensible email and real phone numbers", () => {
    expect(validateStore({ ...stored, name: " ", contactEmail: "nope", contactPhone: "12", whatsappNumber: "" })).toEqual({ name: "Enter the store's name", contactEmail: "Enter an email like hello@yourshop.com", contactPhone: "Enter a number like 0803 123 4567, or with +country code" });
    expect(validateStore(storeToForm(stored))).toEqual({});
  });
});

describe("missingStoreDetails", () => {
  const full = { name: "J", contactEmail: "a@b.co", contactPhone: "+2348031234567", whatsappNumber: "+2348031234567", showroomAddress: "Lekki", showroomHours: "" };
  it("names the contact details still blank, and nothing when they are all there", () => {
    expect(missingStoreDetails(full)).toEqual([]);
    expect(missingStoreDetails({ ...full, whatsappNumber: "", contactEmail: " ", showroomAddress: "" })).toEqual(["WhatsApp number", "support email", "showroom address"]);
  });
});

describe("payments and policies", () => {
  it("never lets the last payment method be switched off", () => {
    expect([canSwitchOff(["card"], "card"), canSwitchOff(["card", "bank_transfer"], "card"), canSwitchOff(["card"], "bank_transfer")]).toEqual([false, true, true]);
  });
  it("keeps an unusual stored value selectable", () => {
    expect(holdChoices(45).map((o) => o.minutes)).toEqual([30, 45, 120, 240, 480]);
    expect(holdChoices(60).map((o) => o.minutes)).toEqual([30, 45, 60, 120, 240, 480]);
    expect(returnWindowChoices(10)).toEqual([0, 7, 10, 14, 30]);
  });
});

describe("delivery zones", () => {
  const zone: DeliveryZone = { id: "z1", name: "Lagos Mainland", state: "Lagos", areas: ["Yaba", "Ikeja"], active: true, sameDayCutoffLocal: "14:00", timezone: "Africa/Lagos", sameDayFeeMinor: 350_000, nextDayFeeMinor: 0, nationwideFeeMinor: null, pickupEnabled: true };
  it("round-trips a zone through the form, fees in naira", () => {
    const form = zoneToForm(zone);
    expect(form).toMatchObject({ sameDayFee: "3500", nextDayFee: "0", nationwideFee: "", areas: "Yaba\nIkeja", cutoff: "14:00" });
    expect(zoneToInput(form, "z1")).toEqual({ id: "z1", name: "Lagos Mainland", state: "Lagos", areas: ["Yaba", "Ikeja"], sameDayFeeMinor: 350_000, nextDayFeeMinor: 0, nationwideFeeMinor: null, sameDayCutoffLocal: "14:00", pickupEnabled: true });
  });
  it("treats a blank fee as not offered and zero as free", () => {
    const input = zoneToInput({ ...zoneToForm(zone), sameDayFee: "", nextDayFee: "0", nationwideFee: "1,500.50" });
    expect([input.sameDayFeeMinor, input.nextDayFeeMinor, input.nationwideFeeMinor]).toEqual([null, 0, 150_050]);
  });
  it("needs a name and state, and refuses fees that are not amounts", () => {
    expect(validateZone({ ...zoneToForm(zone), name: "", state: " ", sameDayFee: "abc" })).toEqual({ name: "Name the zone, like Lagos Mainland", state: "Enter the state", sameDayFee: "Enter an amount like 3,500, or leave blank to not offer it" });
  });
  it("splits areas on lines and commas without duplicates", () => expect(parseAreas("Yaba, Ikeja\n yaba \n\nLekki")).toEqual(["Yaba", "Ikeja", "Lekki"]));
  it("lists what a zone offers with prices", () => {
    expect(zoneOptions(zone, (m) => `₦${m / 100}`)).toEqual([
      { name: "Same-day", note: "Order before 2:00 pm", price: "₦3500" },
      { name: "Next day", note: "Arrives the next day", price: "Free" },
      { name: "Pickup", note: "From the showroom", price: "Free" },
    ]);
    expect(cutoffLabel("09:30")).toBe("9:30 am");
  });
});
