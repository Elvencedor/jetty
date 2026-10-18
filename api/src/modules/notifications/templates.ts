import type { Message } from './senders.js';

type Channel = 'sms' | 'email';
type Payload = Record<string, unknown>;

const STORE = "Jetty's Hair";
export const OTP_TTL_MINUTES = 10;

/** Returns null for events this service does not know how to send. */
export function render(eventType: string, channel: Channel, recipient: string, payload: Payload): Message | null {
  const code = typeof payload.code === 'string' ? payload.code : null;
  const orderNumber = typeof payload.orderNumber === 'string' ? payload.orderNumber : null;

  switch (eventType) {
    case 'order.placed': {
      if (!orderNumber) return null;
      return channel === 'sms'
        ? { to: recipient, text: `${STORE}: payment received. Your order ${orderNumber} is confirmed. Track it any time with the order number and this phone number.` }
        : { to: recipient, subject: `Order ${orderNumber} confirmed`, text: `Thank you for shopping with ${STORE}.\n\nYour payment was received and order ${orderNumber} is confirmed. You can track it any time with the order number and the phone number you used at checkout.` };
    }
    case 'auth.otp':
    case 'auth.password_reset': {
      if (!code) return null;
      const reset = eventType === 'auth.password_reset';
      const body = `${reset ? 'Your password reset code' : 'Your sign-in code'} is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Never share it with anyone.`;
      return channel === 'sms'
        ? { to: recipient, text: `${STORE}: ${body}` }
        : { to: recipient, subject: reset ? `${STORE} password reset code` : `${STORE} sign-in code`, text: body };
    }
    default:
      return null;
  }
}

/** Event types whose payload holds a secret that must not outlive its delivery. */
export const SECRET_EVENT_TYPES: readonly string[] = ['auth.otp', 'auth.password_reset'];
