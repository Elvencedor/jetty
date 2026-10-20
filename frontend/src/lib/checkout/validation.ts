import { normaliseNigerianPhone } from "@/lib/format";
import { NIGERIAN_STATES } from "@/lib/geo/states";

export type DeliveryDetails = {
  name: string;
  phone: string;
  email: string;
  addressLine1: string;
  area: string;
  city: string;
  state: string;
  landmark: string;
  riderNote: string;
};

export const emptyDelivery = (): DeliveryDetails => ({ name: "", phone: "", email: "", addressLine1: "", area: "", city: "", state: "", landmark: "", riderNote: "" });

export type DeliveryErrors = Partial<Record<keyof DeliveryDetails, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Checks one field and returns the message to show, or undefined if it is fine. Mirrors what the API accepts. */
export function validateField(field: keyof DeliveryDetails, value: string): string | undefined {
  const v = value.trim();
  switch (field) {
    case "name":
      return v.length >= 2 && v.length <= 120 ? undefined : "Enter your full name";
    case "phone":
      return normaliseNigerianPhone(v) ? undefined : "Enter a Nigerian phone number, e.g. 0803 123 4567";
    case "email":
      return !v || (EMAIL.test(v) && v.length <= 254) ? undefined : "Enter a valid email";
    case "addressLine1":
      return v.length >= 5 && v.length <= 200 ? undefined : "Enter your street address";
    case "city":
      return v.length >= 2 && v.length <= 120 ? undefined : "Enter your city or town";
    case "state":
      return (NIGERIAN_STATES as readonly string[]).includes(v) ? undefined : "Choose your state";
    case "area":
      return v.length <= 120 ? undefined : "Keep the area under 120 characters";
    case "landmark":
      return v.length <= 200 ? undefined : "Keep the landmark under 200 characters";
    case "riderNote":
      return v.length <= 300 ? undefined : "Keep the note under 300 characters";
  }
}

const FIELD_ORDER: (keyof DeliveryDetails)[] = ["name", "phone", "email", "addressLine1", "area", "city", "state", "landmark", "riderNote"];

/** Every problem with the delivery details, in the order the fields appear on screen. */
export function validateDelivery(details: DeliveryDetails): DeliveryErrors {
  const errors: DeliveryErrors = {};
  for (const field of FIELD_ORDER) {
    const message = validateField(field, details[field]);
    if (message) errors[field] = message;
  }
  return errors;
}

/** The first field with a problem, for moving focus to it. */
export const firstInvalid = (errors: DeliveryErrors) => FIELD_ORDER.find((f) => errors[f]);
