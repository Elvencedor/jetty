export type InitializeInput = {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl?: string | undefined;
  channels: string[];
  /** Opaque internal IDs only; never contact details or card data. */
  metadata: Record<string, string>;
};

export type InitializeResult = {
  reference: string;
  accessCode: string;
  authorizationUrl: string;
};

/** The provider definitively refused the request; nothing was created on its side. */
export class PaymentRejectedError extends Error {}

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

export interface PaymentProvider {
  readonly name: string;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  /** Server-to-server lookup by reference; throws PaymentIndeterminateError when the outcome is unknown. */
  verify(reference: string): Promise<VerifiedTransaction>;
}
