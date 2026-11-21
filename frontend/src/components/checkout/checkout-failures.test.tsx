import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/lib/stores/cart";
import { useCheckoutDraft } from "@/lib/stores/checkout-draft";
import { useCustomerSession } from "@/lib/stores/session";
import { API, server } from "@/test/server";
import { Checkout } from "./Checkout";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => new URLSearchParams("step=review"), usePathname: () => "/checkout" }));

const V1 = "11111111-1111-4111-8111-111111111111";

const quote = {
  currency: "NGN", lines: [{ variantId: V1, productId: "p1", slug: "wig", title: "Bone Straight Wig", image: null, options: [], optionSummary: '20" · HD', compareAtPriceMinor: null, availableQuantity: 5, quantity: 3, unitPriceMinor: 5_000_000, lineSubtotalMinor: 15_000_000, discountMinor: 0, lineTotalMinor: 15_000_000, promotionAllocations: [], gift: null }],
  promotions: { applied: [], rejectedCodes: [] }, warnings: [], subtotalMinor: 15_000_000, discountMinor: 0,
  delivery: { method: "delivery", zoneId: "z", zoneName: "Lagos", baseFeeMinor: 250_000, feeMinor: 250_000, freeDeliveryPromotionId: null, estimate: { earliestDate: "2026-11-24", latestDate: "2026-11-25", minDays: 1, maxDays: 2, startsOn: null } },
  deliveryFeeMinor: 250_000, taxMinor: 0, totalMinor: 15_250_000, quoteId: "q", quoteExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

const refuse = (status: number, code: string, message: string, details?: unknown[]) => HttpResponse.json({ error: { code, message, requestId: "r", ...(details ? { details } : {}) } }, { status });

async function placeOrderThatFails(response: Response) {
  server.use(http.post(`${API}/pricing/quote`, () => HttpResponse.json(quote)), http.post(`${API}/checkout`, () => response));
  useCartStore.setState({ lines: [{ variantId: V1, quantity: 3 }], promotionCodes: [] });
  void useCartStore.persist.rehydrate();
  const draft = useCheckoutDraft.getState();
  draft.reset();
  draft.setDetails({ name: "Ada Obi", phone: "0803 123 4567", addressLine1: "12 Allen Avenue", area: "Yaba", city: "Lagos", state: "Lagos" });
  draft.setDeliveryMethod("delivery");
  draft.setPaymentMethod("bank_transfer");
  void useCheckoutDraft.persist.rehydrate();
  useCustomerSession.getState().clear();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Checkout /></QueryClientProvider>);
  const place = await screen.findByRole("button", { name: "Get transfer details" });
  await waitFor(() => expect(place).toBeEnabled());
  await userEvent.click(place);
  return await screen.findByRole("alert");
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
});

describe("when placing an order fails, the checkout says what and where", () => {
  it("names the item that sold out in the meantime, and how many are left", async () => {
    const alert = await placeOrderThatFails(refuse(409, "OUT_OF_STOCK", "Only 1 of Bone Straight Wig (20\" · HD) is left, and you asked for 3.", [{ variantId: V1, productTitle: "Bone Straight Wig", optionSummary: '20" · HD', requestedQuantity: 3, availableQuantity: 1 }]));
    expect(within(alert).getByText("An item in your bag has changed")).toBeInTheDocument();
    expect(within(alert).getByText('Only 1 of Bone Straight Wig (20" · HD) is left, and you asked for 3. Lower the quantity in your bag.')).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "Review your bag" })).toHaveAttribute("href", "/bag");
    expect(within(alert).queryByText(/Some items are no longer available/)).not.toBeInTheDocument();
  });

  it("names an item that is no longer for sale", async () => {
    const alert = await placeOrderThatFails(refuse(422, "VARIANT_UNAVAILABLE", "x", [{ variantId: V1, productTitle: "Bone Straight Wig", optionSummary: '20" · HD', reason: "NOT_FOR_SALE" }]));
    expect(within(alert).getByText('Bone Straight Wig (20" · HD) is no longer available. Remove it from your bag to continue.')).toBeInTheDocument();
  });

  it("names the place that cannot be delivered to, and goes back to the delivery step to change it", async () => {
    const alert = await placeOrderThatFails(refuse(422, "DELIVERY_UNAVAILABLE", "We do not deliver to this location yet."));
    expect(within(alert).getByText("We can't deliver there yet")).toBeInTheDocument();
    expect(within(alert).getByText(/We don't deliver to Yaba, Lagos yet\./)).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Change delivery details" }));
    expect(push).toHaveBeenCalledWith("/checkout?step=delivery");
  });

  it("says which payment method is off and which still work, and goes to the payment step", async () => {
    const alert = await placeOrderThatFails(refuse(422, "PAYMENT_METHOD_UNAVAILABLE", "x", [{ method: "bank_transfer", enabledMethods: ["card"] }]));
    expect(within(alert).getByText("Bank transfer payments aren't available right now. You can still pay by card.")).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Choose another payment method" }));
    expect(push).toHaveBeenCalledWith("/checkout?step=payment");
  });

  it("names the code that ran out", async () => {
    const alert = await placeOrderThatFails(refuse(409, "PROMOTION_UNAVAILABLE", "x", [{ promotionId: "p", code: "SAVE10" }]));
    expect(within(alert).getByText(/The code SAVE10 has just run out of uses/)).toBeInTheDocument();
  });
});

describe("when the price quote already says an item is unavailable", () => {
  it("tells the customer which one before they try to place the order, and points to the bag", async () => {
    server.use(http.post(`${API}/pricing/quote`, () => refuse(422, "VARIANT_UNAVAILABLE", "x", [{ variantId: V1, productTitle: "Bone Straight Wig", optionSummary: '20" · HD', reason: "NOT_FOR_SALE" }])));
    useCartStore.setState({ lines: [{ variantId: V1, quantity: 3 }], promotionCodes: [] });
    void useCartStore.persist.rehydrate();
    const draft = useCheckoutDraft.getState();
    draft.reset();
    draft.setDetails({ name: "Ada Obi", phone: "0803 123 4567", addressLine1: "12 Allen Avenue", area: "Yaba", city: "Lagos", state: "Lagos" });
    draft.setDeliveryMethod("delivery");
    draft.setPaymentMethod("bank_transfer");
    void useCheckoutDraft.persist.rehydrate();
    useCustomerSession.getState().clear();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Checkout /></QueryClientProvider>);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("An item in your bag isn't available any more")).toBeInTheDocument();
    expect(within(alert).getByText('Bone Straight Wig (20" · HD) is no longer available.')).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "Review your bag" })).toHaveAttribute("href", "/bag");
    expect(screen.getByRole("button", { name: "Get transfer details" })).toBeDisabled();
  });
});

