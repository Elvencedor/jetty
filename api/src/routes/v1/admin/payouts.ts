import type { Request, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { getPayoutAccount, listBanks, savePayoutAccount, withProvider, type PayoutAccount } from '../../../modules/payments/payouts.js';
import { apiError, unprocessable } from '../../../lib/errors.js';
import { audited, db, guard, NO_STORE } from './shared.js';

const accountNumber = Joi.string().pattern(/^\d{10}$/).required().messages({ 'string.pattern.base': 'must be a 10-digit account number' });
const bankCode = Joi.string().pattern(/^\d{2,6}$/).required();

const notFoundAccount = () => unprocessable('ACCOUNT_NOT_FOUND', 'We could not find that account. Check the bank and the account number.');

const provider = (request: Request) => {
  const payments = request.server.app.payments;
  if (!payments) throw apiError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not connected to Paystack yet.');
  return payments;
};

/** What the screens may see of the connected account: never the full number. */
const view = (account: PayoutAccount | null, mode: 'live' | 'test') =>
  account
    ? { configured: true as const, mode, subaccountCode: account.subaccountCode, businessName: account.businessName, bankCode: account.bankCode, bankName: account.bankName, accountName: account.accountName, accountLast4: account.accountLast4, updatedAt: account.updatedAt }
    : { configured: false as const, mode };

export const adminPayoutRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/admin/payouts/account',
    options: { ...guard('settings:read'), description: 'The payout (Paystack subaccount) that sales settle to, if one is connected', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response(view(await getPayoutAccount(db(request)), request.server.app.payments?.mode ?? 'test')).header('Cache-Control', NO_STORE),
  },
  {
    method: 'GET',
    path: '/admin/payouts/banks',
    options: { ...guard('settings:write'), description: 'Banks that can receive a payout', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response({ data: await listBanks(provider(request)) }).header('Cache-Control', 'private, max-age=3600'),
  },
  {
    method: 'POST',
    path: '/admin/payouts/resolve',
    options: {
      ...guard('settings:write'),
      description: 'Look up the name on a bank account, so it can be checked before connecting it',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ bankCode, accountNumber }) },
    },
    handler: async (request, h) => {
      const body = request.payload as { bankCode: string; accountNumber: string };
      const resolved = await withProvider(() => provider(request).resolveAccount(body), notFoundAccount);
      return h.response({ accountName: resolved.accountName }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PUT',
    path: '/admin/payouts/account',
    options: {
      ...guard('settings:write'),
      description: 'Connect or change the payout account. The account is looked up again here and the name Paystack returns is what is kept',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ businessName: Joi.string().trim().min(2).max(100).required(), bankCode, accountNumber }) },
    },
    handler: async (request, h) => {
      const body = request.payload as { businessName: string; bankCode: string; accountNumber: string };
      const payments = provider(request);
      const banks = await listBanks(payments);
      const bank = banks.find((b) => b.code === body.bankCode);
      if (!bank) throw unprocessable('UNKNOWN_BANK', 'That bank is not on the list.');
      const resolved = await withProvider(() => payments.resolveAccount({ bankCode: body.bankCode, accountNumber: body.accountNumber }), notFoundAccount);

      // Paystack first, then our record: a failure at Paystack leaves nothing half-connected here.
      const current = await getPayoutAccount(db(request));
      const percentageCharge = current?.percentageCharge ?? 0;
      const { subaccountCode } = await withProvider(() => payments.saveSubaccount({ businessName: body.businessName, bankCode: body.bankCode, accountNumber: body.accountNumber, percentageCharge }, current?.subaccountCode));

      const account: PayoutAccount = {
        subaccountCode,
        businessName: body.businessName,
        bankCode: bank.code,
        bankName: bank.name,
        accountName: resolved.accountName,
        accountLast4: body.accountNumber.slice(-4),
        percentageCharge,
        feeBearer: current?.feeBearer ?? 'subaccount',
        updatedAt: new Date().toISOString(),
      };
      await audited(request, (tx) => savePayoutAccount(tx, request.auth.credentials.adminId!, account), ({ before, after }) => ({
        action: 'settings.payout_account',
        resourceType: 'settings',
        resourceId: 'payout-account',
        before: before && { subaccountCode: before.subaccountCode, bankName: before.bankName, accountLast4: before.accountLast4 },
        after: { subaccountCode: after.subaccountCode, bankName: after.bankName, accountName: after.accountName, accountLast4: after.accountLast4 },
      }));
      return h.response(view(account, payments.mode)).header('Cache-Control', NO_STORE);
    },
  },
];
