import type { Env } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';
import { PermanentSendError, TransientSendError, type Message, type SendResult, type Sender, type Senders } from './senders.js';

type FetchLike = typeof fetch;
const TIMEOUT_MS = 10_000;

async function post(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new TransientSendError(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (res.status === 429 || res.status >= 500) throw new TransientSendError(`provider responded ${res.status}`);
  if (res.status >= 400) throw new PermanentSendError(`provider rejected the message (${res.status}): ${String(body.message ?? '').slice(0, 200)}`);
  return { status: res.status, body };
}

/** Development only: prints messages (which contain one-time codes), so production refuses it. */
export class LogSender implements Sender {
  readonly name = 'log';
  constructor(private readonly logger: Logger) {}
  async send(message: Message): Promise<SendResult> {
    this.logger.info('message (not sent: log provider)', { to: message.to, subject: message.subject, text: message.text });
    return {};
  }
}

/** Termii SMS (https://developers.termii.com). */
export class TermiiSender implements Sender {
  readonly name = 'termii';
  constructor(
    private readonly options: { apiKey: string; senderId: string; baseUrl: string },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  async send(message: Message): Promise<SendResult> {
    const { body } = await post(this.fetchImpl, `${this.options.baseUrl}/api/sms/send`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.options.apiKey,
        to: message.to.replace(/^\+/, ''),
        from: this.options.senderId,
        sms: message.text,
        type: 'plain',
        channel: 'generic',
      }),
    });
    return { providerMessageId: typeof body.message_id === 'string' ? body.message_id : undefined };
  }
}

/** Resend email (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendSender implements Sender {
  readonly name = 'resend';
  constructor(
    private readonly options: { apiKey: string; from: string },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  async send(message: Message): Promise<SendResult> {
    const { body } = await post(this.fetchImpl, 'https://api.resend.com/emails', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({ from: this.options.from, to: [message.to], subject: message.subject ?? '', text: message.text }),
    });
    return { providerMessageId: typeof body.id === 'string' ? body.id : undefined };
  }
}

export function createSenders(env: Env, logger: Logger): Senders {
  const log = new LogSender(logger);
  if (env.isProduction && (env.SMS_PROVIDER === 'log' || env.EMAIL_PROVIDER === 'log')) {
    throw new Error('SMS_PROVIDER and EMAIL_PROVIDER must be real providers in production; the log provider would print one-time codes');
  }
  return {
    sms: env.SMS_PROVIDER === 'termii' ? new TermiiSender({ apiKey: env.TERMII_API_KEY!, senderId: env.TERMII_SENDER_ID!, baseUrl: env.TERMII_BASE_URL }) : log,
    email: env.EMAIL_PROVIDER === 'resend' ? new ResendSender({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! }) : log,
  };
}
