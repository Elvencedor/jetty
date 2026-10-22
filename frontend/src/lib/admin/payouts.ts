/** Ten digits, as every Nigerian bank account number is. */
export const isAccountNumber = (text: string) => /^\d{10}$/.test(text.replace(/\s/g, ""));
export const accountDigits = (text: string) => text.replace(/\D/g, "").slice(0, 10);

/** "GTBank ••••6789". */
export const maskedAccount = (bankName: string, last4: string) => `${bankName} ••••${last4}`;

export type PayoutForm = { businessName: string; bankCode: string; accountNumber: string };

export function validatePayout(f: PayoutForm): Partial<Record<keyof PayoutForm, string>> {
  const errors: Partial<Record<keyof PayoutForm, string>> = {};
  if (f.businessName.trim().length < 2) errors.businessName = "Enter the name customers know the business by";
  if (!f.bankCode) errors.bankCode = "Choose the bank";
  if (!isAccountNumber(f.accountNumber)) errors.accountNumber = "Enter the 10-digit account number";
  return errors;
}
