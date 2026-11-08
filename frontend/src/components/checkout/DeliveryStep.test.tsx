import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDelivery } from "@/lib/checkout/validation";
import { useCartStore } from "@/lib/stores/cart";
import { API, server } from "@/test/server";
import { DeliveryStep } from "./DeliveryStep";

const VARIANT = "11111111-1111-4111-8111-111111111111";

function setup(state: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeliveryStep details={{ ...emptyDelivery(), state }} errors={{}} method={null} onChange={() => undefined} onBlurField={() => undefined} onMethod={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCartStore.setState({ lines: [{ variantId: VARIANT, quantity: 1 }], promotionCodes: [] });
});

describe("DeliveryStep delivery options", () => {
  it("says a state without a delivery zone is not served, instead of blaming the connection", async () => {
    server.use(http.post(`${API}/delivery/quotes`, () => HttpResponse.json({ error: { code: "DELIVERY_UNAVAILABLE", message: "We do not deliver to this location yet.", requestId: "r1" } }, { status: 422 })));
    setup("Anambra");
    expect(await screen.findByText(/We don.t deliver to Anambra yet/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load delivery options/)).not.toBeInTheDocument();
  });

  it("still reports a real failure to reach the server as a connection problem", async () => {
    server.use(http.post(`${API}/delivery/quotes`, () => HttpResponse.error()));
    setup("Lagos");
    expect(await screen.findByText(/couldn.t load delivery options/)).toBeInTheDocument();
  });

  it("lists the options when the state is served", async () => {
    server.use(http.post(`${API}/delivery/quotes`, () => HttpResponse.json({ currency: "NGN", zone: { id: "z1", name: "Lagos", state: "Lagos" }, options: [{ method: "next_day", available: true, baseFeeMinor: 250000, feeMinor: 250000, freeDeliveryApplied: false, estimate: { earliestDate: "2026-11-04", latestDate: "2026-11-04" } }] })));
    setup("Lagos");
    expect(await screen.findByText("Next-day delivery")).toBeInTheDocument();
  });
});
