import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/lib/stores/cart";
import { useCustomerSession } from "@/lib/stores/session";
import { API, server } from "@/test/server";
import { Bag } from "./Bag";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/bag", useSearchParams: () => new URLSearchParams() }));

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";

const quoteLine = (variantId: string, title: string) => ({
  variantId, productId: `p-${variantId}`, slug: "wig", title, image: null, options: [], optionSummary: '20" · HD', compareAtPriceMinor: null, availableQuantity: 5,
  quantity: 1, unitPriceMinor: 5_000_000, lineSubtotalMinor: 5_000_000, discountMinor: 0, lineTotalMinor: 5_000_000, promotionAllocations: [], gift: null,
});
const goodQuote = (ids: string[]) => ({
  currency: "NGN", lines: ids.map((i) => quoteLine(i, `Wig ${i.slice(0, 1)}`)), promotions: { applied: [], rejectedCodes: [] }, warnings: [], subtotalMinor: 5_000_000 * ids.length, discountMinor: 0,
  delivery: null, deliveryFeeMinor: 0, taxMinor: 0, totalMinor: 5_000_000 * ids.length, quoteId: "q", quoteExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});
const unavailable = (details: unknown[]) => HttpResponse.json({ error: { code: "VARIANT_UNAVAILABLE", message: "One or more items are no longer available.", requestId: "r", details } }, { status: 422 });

/** A shop where the listed variants can no longer be sold, and every other quote works. */
function shop(gone: Record<string, unknown>) {
  const seen: string[][] = [];
  server.use(
    http.get(`${API}/products`, () => HttpResponse.json({ data: [], page: { nextCursor: null } })),
    http.post(`${API}/pricing/quote`, async ({ request }) => {
      const items = ((await request.json()) as { items: { variantId: string }[] }).items.map((i) => i.variantId);
      seen.push(items);
      const missing = items.filter((i) => i in gone);
      return missing.length ? unavailable(missing.map((i) => gone[i])) : HttpResponse.json(goodQuote(items));
    }),
  );
  return seen;
}

function renderBag(ids: string[]) {
  useCartStore.setState({ lines: ids.map((variantId) => ({ variantId, quantity: 1 })), promotionCodes: [] });
  void useCartStore.persist.rehydrate();
  useCustomerSession.getState().clear();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Bag /></QueryClientProvider>);
}

beforeEach(() => useCartStore.setState({ lines: [], promotionCodes: [] }));

describe("the bag when an item can no longer be sold", () => {
  it("names the item and why, instead of saying the prices could not update", async () => {
    shop({ [V2]: { variantId: V2, productTitle: "Bone Straight Wig", optionSummary: '20" · HD', reason: "NOT_FOR_SALE" } });
    renderBag([V1, V2]);
    const notice = await screen.findByRole("alert");
    expect(within(notice).getByText("An item in your bag isn't available any more")).toBeInTheDocument();
    expect(within(notice).getByText('Bone Straight Wig (20" · HD) is no longer available.')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't update your prices.")).not.toBeInTheDocument();
  });

  it("does not show lines it cannot name while the notice is up, so there is no mystery 'This item'", async () => {
    shop({ [V2]: { variantId: V2, productTitle: "Bone Straight Wig", optionSummary: "", reason: "NOT_FOR_SALE" } });
    renderBag([V1, V2]);
    await screen.findByRole("alert");
    expect(screen.queryByText("This item")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("does not let the customer go on to checkout until it is dealt with", async () => {
    shop({ [V2]: { variantId: V2, productTitle: "Bone Straight Wig", optionSummary: "", reason: "NOT_FOR_SALE" } });
    renderBag([V1, V2]);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Checkout" })).not.toBeInTheDocument();
  });

  it("removes the item from here, and the total comes back", async () => {
    const seen = shop({ [V2]: { variantId: V2, productTitle: "Bone Straight Wig", optionSummary: "", reason: "NOT_FOR_SALE" } });
    renderBag([V1, V2]);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Bone Straight Wig from your bag" }));
    expect(useCartStore.getState().lines.map((l) => l.variantId)).toEqual([V1]);
    await waitFor(() => expect(screen.queryByText("An item in your bag isn't available any more")).not.toBeInTheDocument());
    expect(await screen.findByText("Total")).toBeInTheDocument();
    // The bag asks again, without the item that was removed.
    await waitFor(() => expect(seen.at(-1)).toEqual([V1]));
  });

  it("says plainly when an item no longer exists and so cannot be named, and still lets it be removed", async () => {
    shop({ [V2]: { variantId: V2, productTitle: null, optionSummary: "", reason: "REMOVED" } });
    renderBag([V1, V2]);
    expect(await screen.findByText("An item in your bag is no longer sold.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove An item in your bag from your bag" }));
    expect(useCartStore.getState().lines.map((l) => l.variantId)).toEqual([V1]);
  });

  it("lists several, and removes them all at once", async () => {
    shop({
      [V2]: { variantId: V2, productTitle: "Wig Two", optionSummary: "", reason: "NOT_FOR_SALE" },
      [V3]: { variantId: V3, productTitle: "Wig Three", optionSummary: '14"', reason: "NOT_FOR_SALE" },
    });
    renderBag([V1, V2, V3]);
    const notice = await screen.findByRole("alert");
    expect(within(notice).getByText("2 items in your bag aren't available any more")).toBeInTheDocument();
    expect(within(notice).getByText("Wig Two is no longer available.")).toBeInTheDocument();
    expect(within(notice).getByText('Wig Three (14") is no longer available.')).toBeInTheDocument();
    await userEvent.click(within(notice).getByRole("button", { name: "Remove all" }));
    expect(useCartStore.getState().lines.map((l) => l.variantId)).toEqual([V1]);
  });

  it("still says the prices could not update when it really is a connection problem", async () => {
    server.use(http.get(`${API}/products`, () => HttpResponse.json({ data: [], page: { nextCursor: null } })), http.post(`${API}/pricing/quote`, () => HttpResponse.error()));
    renderBag([V1]);
    // A dropped connection is tried once more before it is reported.
    expect(await screen.findByText("We couldn't update your prices.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/isn't available any more/)).not.toBeInTheDocument();
  });
});
