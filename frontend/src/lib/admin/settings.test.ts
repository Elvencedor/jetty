import { describe, expect, it } from "vitest";
import type { DeliveryZone } from "@/lib/api/admin-settings";
import { missingStoreDetails, canSwitchOff, changedFields, deliveryDaysLabel, holdChoices, parseAreas, returnWindowChoices, storeToForm, storeToSettings, validateStore, validateZone, zoneCoverage, zoneOptions, zoneToForm, zoneToInput } from "./settings";

describe("changedFields", () => {
  it("returns only what differs, and null when nothing does", () => {
    expect(changedFields({ a: 1, b: [1, 2], c: "x" }, { a: 1, b: [1, 3], c: "x" })).toEqual({ b: [1, 3] });
    expect(changedFields({ a: 1 }, { a: 1 })).toBeNull();
  });
});

describe("store details", () => {
  const stored = { name: "Jetty's Hairs", contactEmail: "hello@example.com", contactPhone: "+2348031234567", whatsappNumber: "", showroomAddress: " Lekki ", showroomHours: "" };
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
  const zone: DeliveryZone = { id: "z1", name: "Lagos Mainland", scope: "state", state: "Lagos", states: [], areas: ["Yaba", "Ikeja"], active: true, timezone: "Africa/Lagos", deliveryFeeMinor: 350_000, deliveryMinDays: 1, deliveryMaxDays: 2, pickupEnabled: true };
  const north: DeliveryZone = { ...zone, id: "z2", name: "North", scope: "nationwide", state: null, states: ["Kano", "Kaduna"], areas: [], deliveryFeeMinor: 600_000, deliveryMinDays: 2, deliveryMaxDays: 4 };
  it("round-trips a state zone through the form, the price in naira", () => {
    const form = zoneToForm(zone);
    expect(form).toMatchObject({ scope: "state", state: "Lagos", deliveryFee: "3,500", minDays: "1", maxDays: "2", areas: "Yaba\nIkeja" });
    expect(zoneToInput(form, "z1")).toEqual({ id: "z1", name: "Lagos Mainland", scope: "state", state: "Lagos", states: [], areas: ["Yaba", "Ikeja"], deliveryFeeMinor: 350_000, deliveryMinDays: 1, deliveryMaxDays: 2, pickupEnabled: true });
  });
  it("round-trips a nationwide zone: its states, and no state or areas", () => {
    const form = zoneToForm(north);
    expect(form).toMatchObject({ scope: "nationwide", state: "", states: ["Kano", "Kaduna"] });
    expect(zoneToInput(form, "z2")).toMatchObject({ scope: "nationwide", state: null, states: ["Kano", "Kaduna"], areas: [], deliveryFeeMinor: 600_000, deliveryMinDays: 2, deliveryMaxDays: 4 });
  });
  it("drops what the chosen coverage does not use", () => {
    expect(zoneToInput({ ...zoneToForm(north), scope: "state", state: "Kano", areas: "" })).toMatchObject({ scope: "state", state: "Kano", states: [] });
    expect(zoneToInput({ ...zoneToForm(zone), scope: "nationwide", states: ["Kano"] })).toMatchObject({ scope: "nationwide", state: null, states: ["Kano"], areas: [] });
  });
  it("treats a blank price as pickup only, zero as free, and takes naira with commas", () => {
    expect(zoneToInput({ ...zoneToForm(zone), deliveryFee: "" }).deliveryFeeMinor).toBeNull();
    expect(zoneToInput({ ...zoneToForm(zone), deliveryFee: "0" }).deliveryFeeMinor).toBe(0);
    expect(zoneToInput({ ...zoneToForm(zone), deliveryFee: "1,500.50" }).deliveryFeeMinor).toBe(150_050);
  });
  it("needs a name, a state or states, an amount and sensible days", () => {
    expect(validateZone({ ...zoneToForm(zone), name: "", state: " ", deliveryFee: "abc" })).toEqual({ name: "Name the zone, like Lagos Mainland", state: "Choose the state", deliveryFee: "Enter an amount like 3,500, or leave blank for pickup only" });
    expect(validateZone({ ...zoneToForm(north), states: [] })).toEqual({ states: "Pick at least one state" });
    expect(validateZone({ ...zoneToForm(zone), minDays: "x", maxDays: "61" })).toEqual({ minDays: "A whole number of days, 0 to 60", maxDays: "A whole number of days, 0 to 60" });
    expect(validateZone({ ...zoneToForm(zone), minDays: "5", maxDays: "2" })).toEqual({ maxDays: "Can't be shorter than the fastest time" });
    expect(validateZone({ ...zoneToForm(zone), minDays: "0", maxDays: "0" })).toEqual({});
  });
  it("splits areas on lines and commas without duplicates", () => expect(parseAreas("Yaba, Ikeja\n yaba \n\nLekki")).toEqual(["Yaba", "Ikeja", "Lekki"]));
  it("says how long delivery takes", () => {
    expect([deliveryDaysLabel(0, 0), deliveryDaysLabel(1, 1), deliveryDaysLabel(3, 3), deliveryDaysLabel(2, 4)]).toEqual(["Same day", "Next day", "3 days", "2 to 4 days"]);
  });
  it("describes where a zone delivers", () => {
    expect(zoneCoverage(zone)).toBe("Lagos · Yaba, Ikeja");
    expect(zoneCoverage({ ...zone, areas: [] })).toBe("Lagos · whole state");
    expect(zoneCoverage(north)).toBe("Nationwide · 2 states");
  });
  it("lists the one delivery option with its price and time, then pickup", () => {
    expect(zoneOptions(zone, (m) => `₦${m / 100}`)).toEqual([
      { name: "Delivery", note: "1 to 2 days", price: "₦3500" },
      { name: "Pickup", note: "From the showroom", price: "Free" },
    ]);
    expect(zoneOptions({ ...zone, deliveryFeeMinor: null, pickupEnabled: false }, String)).toEqual([]);
  });
});
