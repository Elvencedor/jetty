import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { storeSettings } from '../../db/schema/index.js';
import { apiError, unprocessable } from '../../lib/errors.js';
import { PaymentIndeterminateError, PaymentRejectedError, type Bank, type PaymentProvider } from './provider.js';

/**
 * Where sales are paid out: a Paystack subaccount. Paystack holds the account number; only the last four digits and the
 * name it resolved are kept here, to show the owner what is connected.
 */
export type PayoutAccount = {
  subaccountCode: string;
  businessName: string;
  bankCode: string;
  bankName: string;
  accountName: string;
  accountLast4: string;
  /** The share of each sale the main Paystack account keeps. */
  percentageCharge: number;
  /** Who pays Paystack's fee on a sale. */
  feeBearer: 'account' | 'subaccount';
  updatedAt: string;
};

const KEY = 'app.payout_account';

export async function getPayoutAccount(db: Db): Promise<PayoutAccount | null> {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.key, KEY));
  return (row?.value as PayoutAccount | undefined) ?? null;
}

export async function savePayoutAccount(db: Db, adminId: string, account: PayoutAccount) {
  const before = await getPayoutAccount(db);
  await db
    .insert(storeSettings)
    .values({ key: KEY, value: account, updatedByAdminId: adminId })
    .onConflictDoUpdate({ target: storeSettings.key, set: { value: account, updatedByAdminId: adminId, updatedAt: new Date() } });
  return { before, after: account };
}

const BANK_CACHE_MS = 24 * 60 * 60 * 1000;
let bankCache: { at: number; banks: Bank[] } | null = null;

/** Banks change rarely, and Paystack's list is several calls, so keep it for a day. */
export async function listBanks(provider: PaymentProvider, now = Date.now()): Promise<Bank[]> {
  if (bankCache && now - bankCache.at < BANK_CACHE_MS) return bankCache.banks;
  const banks = await withProvider(() => provider.listBanks());
  bankCache = { at: now, banks };
  return banks;
}

export const resetBankCache = () => {
  bankCache = null;
};

/** A provider call whose failures become API errors an admin can act on. */
export async function withProvider<T>(run: () => Promise<T>, rejected?: () => Error): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PaymentRejectedError) throw rejected?.() ?? unprocessable('PAYOUT_REJECTED', err.detail ?? 'Paystack did not accept those details.');
    if (err instanceof PaymentIndeterminateError) throw apiError(503, 'PAYSTACK_UNAVAILABLE', 'Paystack could not be reached. Try again shortly.');
    throw err;
  }
}
