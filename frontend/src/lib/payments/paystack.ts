/** What happened in the Paystack popup. A "success" only means the shopper finished; the server must still verify it. */
export type PopupResult = { kind: "success"; reference: string } | { kind: "cancelled" } | { kind: "error"; message: string };

/**
 * Opens Paystack's popup for a transaction initialised by our API (`accessCode`). The library loads only now, so it
 * is not part of any page's first load. Resolves once, with how the popup ended.
 */
export async function openPaystack(accessCode: string): Promise<PopupResult> {
  let PaystackPop: typeof import("@paystack/inline-js").default;
  try {
    PaystackPop = (await import("@paystack/inline-js")).default;
  } catch {
    return { kind: "error", message: "We couldn't load the payment window. Check your connection and try again." };
  }
  return new Promise<PopupResult>((resolve) => {
    new PaystackPop().resumeTransaction(accessCode, {
      onSuccess: (tx) => resolve({ kind: "success", reference: tx.reference }),
      onCancel: () => resolve({ kind: "cancelled" }),
      onError: (err) => resolve({ kind: "error", message: err.message || "The payment window had a problem." }),
    });
  });
}
