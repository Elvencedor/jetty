import {
  PaymentIndeterminateError,
  PaymentRejectedError,
  type Bank,
  type InitializeInput,
  type InitializeResult,
  type PaymentProvider,
  type RefundInput,
  type RefundResult,
  type ResolvedAccount,
  type Subaccount,
  type SubaccountInput,
  type VerifiedTransaction,
} from './provider.js';

type Envelope = { status?: boolean; message?: string; data?: unknown; meta?: { next?: string | null } };
type PaystackBank = { name?: string; code?: string; active?: boolean; is_deleted?: boolean };
type Options = { secretKey: string; baseUrl: string; timeoutMs?: number; fetch?: typeof fetch };

/** Paystack Initialize Transaction. The secret key never leaves this class. */
export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  readonly mode: 'live' | 'test';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Options) {
    this.fetchImpl = options.fetch ?? fetch;
    this.mode = options.secretKey.startsWith('sk_live_') ? 'live' : 'test';
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
          ...(input.subaccount ? { subaccount: input.subaccount, bearer: input.bearer ?? 'subaccount' } : {}),
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

  /** One Paystack call: the same timeout and error mapping everywhere. Rejections carry Paystack's own message for the admin. */
  private async call(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<Envelope> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.options.secretKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new PaymentIndeterminateError('Paystack did not respond');
    }
    if (res.status >= 500 || res.status === 429) throw new PaymentIndeterminateError(`Paystack responded ${res.status}`);
    const json = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok || !json?.status) throw new PaymentRejectedError(`Paystack rejected the request (${res.status})`, String(json?.message ?? '').slice(0, 200) || undefined);
    return json;
  }

  async listBanks(): Promise<Bank[]> {
    const banks: Bank[] = [];
    let cursor: string | null = null;
    // Paystack pages banks with a cursor, 100 at a time; a handful of pages covers Nigeria.
    for (let page = 0; page < 10; page++) {
      const json: Envelope = await this.call('GET', `/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100${cursor ? `&next=${encodeURIComponent(cursor)}` : ''}`);
      for (const b of Array.isArray(json.data) ? (json.data as PaystackBank[]) : []) if (b.name && b.code && b.active !== false && !b.is_deleted) banks.push({ name: b.name, code: b.code });
      cursor = json.meta?.next ?? null;
      if (!cursor) break;
    }
    return [...new Map(banks.map((b) => [b.code, b])).values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async resolveAccount(input: { bankCode: string; accountNumber: string }): Promise<ResolvedAccount> {
    const json = await this.call('GET', `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`);
    const data = json.data as { account_name?: string; account_number?: string } | undefined;
    if (!data?.account_name) throw new PaymentIndeterminateError('Unexpected Paystack response');
    return { accountName: data.account_name, accountNumber: data.account_number ?? input.accountNumber };
  }

  async saveSubaccount(input: SubaccountInput, code?: string): Promise<Subaccount> {
    const body = { business_name: input.businessName, settlement_bank: input.bankCode, account_number: input.accountNumber, percentage_charge: input.percentageCharge };
    const json = await (code ? this.call('PUT', `/subaccount/${encodeURIComponent(code)}`, body) : this.call('POST', '/subaccount', body));
    const subaccountCode = (json.data as { subaccount_code?: string } | undefined)?.subaccount_code ?? code;
    if (!subaccountCode) throw new PaymentIndeterminateError('Unexpected Paystack response');
    return { subaccountCode };
  }
}
