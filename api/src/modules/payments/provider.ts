export type InitializeInput = {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl?: string | undefined;
  channels: string[];
  /** Opaque internal IDs only; never contact details or card data. */
  metadata: Record<string, string>;
  /** Paystack subaccount code (ACCT_…): the sale settles to that payout account. */
  subaccount?: string | undefined;
  /** Who pays Paystack's fee on a split sale. */
  bearer?: 'account' | 'subaccount' | undefined;
};

export type InitializeResult = {
  reference: string;
  accessCode: string;
  authorizationUrl: string;
};

/** The provider definitively refused the request; nothing was created on its side. */
export class PaymentRejectedError extends Error {
  /** What the provider said, safe to show an admin (never a secret). */
  detail: string | undefined;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

/** Timeout, network or 5xx: the provider may or may not have created the transaction. */
export class PaymentIndeterminateError extends Error {}

export type VerifiedTransaction =
  | { found: false }
  | {
      found: true;
      reference: string;
      /** Provider status: 'success', 'failed', 'abandoned', 'ongoing', 'pending', 'reversed', ... */
      status: string;
      amountMinor: number;
      currency: string;
      transactionId: string;
      paidAt: Date | null;
    };

export type RefundInput = {
  /** Reference of the successful charge being refunded. */
  reference: string;
  amountMinor: number;
  currency: string;
  /** Shown to the customer by the provider. */
  customerNote?: string | undefined;
  merchantNote?: string | undefined;
};

export type RefundResult = {
  providerReference: string;
  /** Provider status, e.g. 'pending', 'processing', 'processed'. */
  status: string;
};

export type Bank = { name: string; code: string };
export type ResolvedAccount = { accountName: string; accountNumber: string };

export type SubaccountInput = {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  /** The share of each sale the main account keeps, 0 to 100. */
  percentageCharge: number;
};
export type Subaccount = { subaccountCode: string };

export interface PaymentProvider {
  readonly name: string;
  /** Test keys move no real money; the admin screens say which one is in use. */
  readonly mode: 'live' | 'test';
  initialize(input: InitializeInput): Promise<InitializeResult>;
  /** Server-to-server lookup by reference; throws PaymentIndeterminateError when the outcome is unknown. */
  verify(reference: string): Promise<VerifiedTransaction>;
  /** Throws PaymentRejectedError when refused outright, PaymentIndeterminateError when the outcome is unknown. */
  refund(input: RefundInput): Promise<RefundResult>;
  /** Nigerian banks that can receive a payout, by name. */
  listBanks(): Promise<Bank[]>;
  /** Looks up who owns an account number at a bank. Throws PaymentRejectedError when there is no such account. */
  resolveAccount(input: { bankCode: string; accountNumber: string }): Promise<ResolvedAccount>;
  /** Creates the payout (sub)account, or updates it when `code` is given. */
  saveSubaccount(input: SubaccountInput, code?: string): Promise<Subaccount>;
}
