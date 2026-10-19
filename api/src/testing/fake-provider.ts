import {
  PaymentIndeterminateError,
  PaymentRejectedError,
  type InitializeInput,
  type PaymentProvider,
  type RefundInput,
  type VerifiedTransaction,
} from '../modules/payments/provider.js';

type Txn = { status: string; amountMinor: number; currency: string; id: string };

/** In-memory Paystack stand-in: initialized transactions read as 'abandoned' until a test pays them. */
export class FakeProvider implements PaymentProvider {
  readonly name = 'paystack';
  calls: InitializeInput[] = [];
  initializeMode: 'ok' | 'reject' | 'timeout' = 'ok';
  verifyDown = false;
  verifyCalls = 0;
  refundMode: 'ok' | 'reject' | 'timeout' = 'ok';
  refunds: RefundInput[] = [];
  transactions = new Map<string, Txn>();
  private seq = 1000;

  reset() {
    this.calls = [];
    this.initializeMode = 'ok';
    this.verifyDown = false;
    this.verifyCalls = 0;
    this.refundMode = 'ok';
    this.refunds = [];
  }

  async initialize(input: InitializeInput) {
    this.calls.push(input);
    if (this.initializeMode === 'reject') throw new PaymentRejectedError('rejected');
    if (this.initializeMode === 'timeout') throw new PaymentIndeterminateError('timeout');
    this.transactions.set(input.reference, { status: 'abandoned', amountMinor: input.amountMinor, currency: input.currency, id: String(++this.seq) });
    return { reference: input.reference, accessCode: 'ac_test', authorizationUrl: `https://checkout.paystack.test/${input.reference}` };
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    this.verifyCalls++;
    if (this.verifyDown) throw new PaymentIndeterminateError('down');
    const t = this.transactions.get(reference);
    if (!t) return { found: false };
    return { found: true, reference, status: t.status, amountMinor: t.amountMinor, currency: t.currency, transactionId: t.id, paidAt: t.status === 'success' ? new Date() : null };
  }

  async refund(input: RefundInput) {
    this.refunds.push(input);
    if (this.refundMode === 'reject') throw new PaymentRejectedError('rejected');
    if (this.refundMode === 'timeout') throw new PaymentIndeterminateError('timeout');
    return { providerReference: `rf_${this.refunds.length}`, status: 'pending' };
  }

  /** Test control: set the provider-side state of a transaction. */
  set(reference: string, patch: Partial<Txn>) {
    const current = this.transactions.get(reference) ?? { status: 'abandoned', amountMinor: 0, currency: 'NGN', id: String(++this.seq) };
    this.transactions.set(reference, { ...current, ...patch });
  }
}
