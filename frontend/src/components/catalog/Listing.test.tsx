import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyListState } from "@/lib/catalog/params";
import { Listing } from "./Listing";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/shop", useSearchParams: () => new URLSearchParams() }));

function setup(facets: Parameters<typeof Listing>[0]["facets"] = null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Listing title="All wigs" crumbs={["Wigs"]} path="/shop" state={emptyListState()} initial={{ items: [], nextCursor: null, total: 0 }} facets={facets} />
    </QueryClientProvider>,
  );
}

// jsdom has no layout, so no scrollIntoView; the sheet calls it to bring the tapped group into view.
Element.prototype.scrollIntoView = vi.fn();

const facets = {
  options: { texture: [{ valueKey: "straight", label: "Straight", count: 3 }], lace: [], length: [], density: [], colour: [] },
  price: { minMinor: 1000000, maxMinor: 5000000 },
  inStockCount: 3,
  onOfferCount: 0,
} as unknown as Parameters<typeof Listing>[0]["facets"];

describe("Listing filter buttons", () => {
  it("disables a pill with nothing to filter by, and enables the ones that have choices", () => {
    setup(facets);
    expect(screen.getByRole("button", { name: "Texture" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Price" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Lace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Length" })).toBeDisabled();
  });

  it("explains an empty sheet instead of showing only toggles", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /All filters/ }));
    expect(await screen.findByText(/nothing to filter by yet/)).toBeInTheDocument();
  });

  it("All filters opens the filter sheet", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /All filters/ }));
    expect(await screen.findByRole("dialog", { name: "Filters" })).toBeInTheDocument();
  });

  it("a pill opens a sheet with only its own group", async () => {
    setup(facets);
    await userEvent.click(screen.getByRole("button", { name: "Texture" }));
    const sheet = await screen.findByRole("dialog", { name: "Texture" });
    expect(within(sheet).getByRole("button", { name: "Straight" })).toBeInTheDocument();
    expect(within(sheet).queryByText(/In stock only/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Price")).not.toBeInTheDocument();
  });

  it("the Price pill shows the price range and nothing else", async () => {
    setup(facets);
    await userEvent.click(screen.getByRole("button", { name: "Price" }));
    const sheet = await screen.findByRole("dialog", { name: "Price" });
    expect(within(sheet).queryByRole("button", { name: "Straight" })).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/On offer/)).not.toBeInTheDocument();
  });

  it("All filters shows every group together with the stock and offer switches", async () => {
    setup(facets);
    await userEvent.click(screen.getByRole("button", { name: /All filters/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("button", { name: "Straight" })).toBeInTheDocument();
    expect(within(sheet).getByText(/In stock only/)).toBeInTheDocument();
  });
});
