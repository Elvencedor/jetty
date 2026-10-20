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
    case 'order.packed':
    case 'order.out_for_delivery':
    case 'order.delivered': {
      if (!orderNumber) return null;
      const pickup = payload.deliveryMethod === 'pickup';
      const line =
        eventType === 'order.packed'
          ? pickup ? `is packed and ready for you to collect` : `is packed and will be on its way soon`
          : eventType === 'order.out_for_delivery'
            ? `is out for delivery. Please keep your phone close`
            : pickup ? `has been collected. Thank you!` : `has been delivered. Enjoy your new look!`;
      const subject = eventType === 'order.delivered' ? `Order ${orderNumber} ${pickup ? 'collected' : 'delivered'}` : eventType === 'order.packed' ? `Order ${orderNumber} packed` : `Order ${orderNumber} out for delivery`;
      return channel === 'sms' ? { to: recipient, text: `${STORE}: your order ${orderNumber} ${line}.` } : { to: recipient, subject, text: `Hello from ${STORE},\n\nYour order ${orderNumber} ${line}.` };
    }
    case 'order.cancelled': {
      if (!orderNumber) return null;
      const line = `Your order ${orderNumber} has been cancelled.${payload.refundDue === true ? ' Your payment will be refunded; we will message you when it starts.' : ''}`;
      return channel === 'sms' ? { to: recipient, text: `${STORE}: ${line}` } : { to: recipient, subject: `Order ${orderNumber} cancelled`, text: `Hello from ${STORE},\n\n${line}` };
    }
    case 'order.refunded': {
      if (!orderNumber || typeof payload.amount !== 'string') return null;
      const line = `A refund of ₦${payload.amount} for order ${orderNumber} has been started. Your bank may take a few days to show it.`;
      return channel === 'sms' ? { to: recipient, text: `${STORE}: ${line}` } : { to: recipient, subject: `Refund started for order ${orderNumber}`, text: `Hello from ${STORE},\n\n${line}` };
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
