import {
  PaymentIndeterminateError,
  PaymentRejectedError,
  type InitializeInput,
  type InitializeResult,
  type PaymentProvider,
  type RefundInput,
  type RefundResult,
  type VerifiedTransaction,
} from './provider.js';

type Options = { secretKey: string; baseUrl: string; timeoutMs?: number; fetch?: typeof fetch };

/** Paystack Initialize Transaction. The secret key never leaves this class. */
export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Options) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
          channels: input.channels,
          metadata: input.metadata,
          ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new PaymentIndeterminateError('Paystack did not respond');
    }

    if (res.status >= 500 || res.status === 429) throw new PaymentIndeterminateError(`Paystack responded ${res.status}`);

    const body = (await res.json().catch(() => null)) as {
      status?: boolean;
      data?: { reference?: string; access_code?: string; authorization_url?: string };
    } | null;
    const data = body?.data;
    if (res.ok && body?.status && data?.access_code && data.authorization_url && data.reference) {
      return { reference: data.reference, accessCode: data.access_code, authorizationUrl: data.authorization_url };
    }
    if (res.ok) throw new PaymentIndeterminateError('Unexpected Paystack response');
    throw new PaymentRejectedError(`Paystack rejected the request (${res.status})`);
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${this.options.secretKey}` },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new PaymentIndeterminateError('Paystack did not respond');
    }

    if (res.status === 404) return { found: false };
    if (!res.ok) throw new PaymentIndeterminateError(`Paystack responded ${res.status}`);

    const body = (await res.json().catch(() => null)) as {
      status?: boolean;
      data?: { reference?: string; status?: string; amount?: number; currency?: string; id?: number | string; paid_at?: string | null };
    } | null;
    const d = body?.data;
    if (!body?.status || !d || typeof d.status !== 'string' || !Number.isInteger(d.amount) || typeof d.currency !== 'string' || d.id === undefined || !d.reference) {
      throw new PaymentIndeterminateError('Unexpected Paystack response');
    }
    return {
      found: true,
      reference: d.reference,
      status: d.status,
      amountMinor: d.amount as number,
      currency: d.currency,
      transactionId: String(d.id),
      paidAt: d.paid_at ? new Date(d.paid_at) : null,
    };
  }

  /** Paystack Create Refund. The refund id it returns is the reference we keep. */
  async refund(input: RefundInput): Promise<RefundResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: input.reference,
          amount: input.amountMinor,
          currency: input.currency,
          ...(input.customerNote ? { customer_note: input.customerNote } : {}),
          ...(input.merchantNote ? { merchant_note: input.merchantNote } : {}),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new PaymentIndeterminateError('Paystack did not respond');
    }
    if (res.status >= 500 || res.status === 429) throw new PaymentIndeterminateError(`Paystack responded ${res.status}`);

    const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: { id?: number | string; status?: string } } | null;
    if (res.ok && body?.status && body.data?.id !== undefined && typeof body.data.status === 'string') {
      return { providerReference: String(body.data.id), status: body.data.status };
    }
    if (res.ok) throw new PaymentIndeterminateError('Unexpected Paystack response');
    throw new PaymentRejectedError(`Paystack rejected the refund (${res.status}): ${String(body?.message ?? '').slice(0, 200)}`);
  }
}
