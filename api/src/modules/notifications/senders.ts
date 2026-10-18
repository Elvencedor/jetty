export type Message = { to: string; subject?: string; text: string };

/** What a successful send reports back; stored on the outbox row. */
export type SendResult = { providerMessageId?: string | undefined };

export interface Sender {
  readonly name: string;
  send(message: Message): Promise<SendResult>;
}

/** The provider will never accept this message (bad number, rejected content); retrying is pointless. */
export class PermanentSendError extends Error {
  override readonly name = 'PermanentSendError';
}

/** A timeout, 5xx or rate limit; the message may be retried later. */
export class TransientSendError extends Error {
  override readonly name = 'TransientSendError';
}

export type Senders = { sms: Sender; email: Sender };
