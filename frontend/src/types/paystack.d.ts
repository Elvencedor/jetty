declare module "@paystack/inline-js" {
  type Callbacks = {
    onSuccess?: (transaction: { reference: string; status?: string }) => void;
    onCancel?: () => void;
    onLoad?: () => void;
    onError?: (error: { message?: string }) => void;
  };
  export default class PaystackPop {
    constructor();
    /** Opens the checkout popup for a transaction the server already initialised. */
    resumeTransaction(accessCode: string, callbacks?: Callbacks): unknown;
  }
}
