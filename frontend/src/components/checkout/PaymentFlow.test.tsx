import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/lib/stores/cart";
import { useCheckoutDraft } from "@/lib/stores/checkout-draft";
import { usePaymentSession } from "@/lib/stores/payment-session";
import { API, server } from "@/test/server";
import { PaymentFlow } from "./PaymentFlow";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/lib/payments/paystack", () => ({ openPaystack: vi.fn().mockResolvedValue({ kind: "cancelled" }) }));

const ORDER = "22222222-2222-4222-8222-222222222222";
const V1 = "11111111-1111-4111-8111-111111111111";
const future = () => new Date(Date.now() + 30 * 60_000).toISOString();

const status = (over: Record<string, unknown> = {}) => ({
  orderId: ORDER, orderNumber: "JH-1", status: "pending_payment", paymentStatus: "pending", amountMinor: 5_600_000, currency: "NGN", reservationExpiresAt: future(),
  deliveryMethod: "delivery", estimate: null, itemCount: 1, recipientFirstName: "Ada", paymentAttempt: { id: "a1", status: "pending" }, ...over,
});

function setup(method: "card" | "bank_transfer", body: Record<string, unknown>) {
  server.use(http.get(`${API}/checkout/${ORDER}/status`, () => HttpResponse.json(body)));
  usePaymentSession.getState().set({ orderId: ORDER, orderNumber: "JH-1", reference: "ref", accessCode: "ac", amountMinor: 5_600_000, quotedMinor: 5_600_000, reservationExpiresAt: future(), method });
  // The app fills its stores from storage when it starts; the component waits for that.
  void usePaymentSession.persist.rehydrate();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PaymentFlow orderId={ORDER} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  useCartStore.setState({ lines: [{ variantId: V1, quantity: 2 }], promotionCodes: [] });
  useCheckoutDraft.getState().reset();
});

describe("PaymentFlow: the bag after an order is placed", () => {
  it("clears the bag for a bank-transfer order, which already holds the items, and offers a link to the order", async () => {
    setup("bank_transfer", status());
    expect(await screen.findByRole("link", { name: "View your order" })).toHaveAttribute("href", `/order/${ORDER}/confirmed`);
    await waitFor(() => expect(useCartStore.getState().lines).toEqual([]));
    // The items are remembered, in case the order closes unpaid.
    expect(usePaymentSession.getState().payment?.lines).toEqual([{ variantId: V1, quantity: 2 }]);
  });

  it("keeps the bag for a card payment until it is confirmed, so a failed attempt can choose another method", async () => {
    setup("card", status());
    await screen.findByText("Order JH-1");
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it("clears the bag and opens the confirmation once the payment is confirmed", async () => {
    setup("card", status({ status: "placed", paymentStatus: "paid", paymentAttempt: { id: "a1", status: "succeeded" } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/order/${ORDER}/confirmed`));
    expect(useCartStore.getState().lines).toEqual([]);
    expect(usePaymentSession.getState().payment).toBeNull();
  });

  it("puts the items back when a transfer order closes unpaid", async () => {
    setup("bank_transfer", status({ status: "cancelled", paymentStatus: "failed", paymentAttempt: { id: "a1", status: "expired" } }));
    // The bag was emptied when the order was placed; here it already is, and the snapshot is what remains.
    useCartStore.setState({ lines: [] });
    usePaymentSession.getState().set({ ...usePaymentSession.getState().payment!, lines: [{ variantId: V1, quantity: 2 }] });
    await act(async () => undefined);
    await userEvent.click(await screen.findByRole("button", { name: "Put my items back in the bag" }));
    expect(useCartStore.getState().lines).toEqual([{ variantId: V1, quantity: 2 }]);
    expect(push).toHaveBeenCalledWith("/bag");
  });

  it("offers to start the payment when there is no payment window to open, and opens it once the API starts one", async () => {
    server.use(
      http.get(`${API}/checkout/${ORDER}/status`, () => HttpResponse.json(status({ paymentAttempt: { id: "a1", status: "initializing" } }))),
      http.post(`${API}/checkout/${ORDER}/payment-attempts`, () => HttpResponse.json({ orderId: ORDER, orderNumber: "JH-1", reference: "ref2", accessCode: "ac2", amountMinor: 5_600_000, reservationExpiresAt: future() }, { status: 201 })),
    );
    // No payment in this tab's session: the first start never got an access code from the provider.
    usePaymentSession.getState().set(null);
    void usePaymentSession.persist.rehydrate();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PaymentFlow orderId={ORDER} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Start payment" }));
    await waitFor(() => expect(usePaymentSession.getState().payment?.accessCode).toBe("ac2"));
    expect(await screen.findByRole("button", { name: /^Pay / })).toBeInTheDocument();
  });
});
