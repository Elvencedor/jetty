import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote, QuoteLine } from "@/lib/api/types";
import { useCartStore, API_MAX_CODES } from "@/lib/stores/cart";
import type { LineView } from "@/lib/cart/model";
import { BagLine, GiftLine } from "./BagLine";
import { CodeEntry } from "./CodeEntry";
import { PriceSummary, type SummaryData } from "./PriceSummary";

const line = (over: Partial<QuoteLine> = {}): QuoteLine => ({
  variantId: "v1", productId: "p1", slug: "bone-straight", title: "Bone Straight Wig", image: null, options: [], optionSummary: '20" · HD', compareAtPriceMinor: null,
  availableQuantity: 5, quantity: 2, unitPriceMinor: 5_000_000, lineSubtotalMinor: 10_000_000, discountMinor: 0, lineTotalMinor: 10_000_000, promotionAllocations: [], gift: null, ...over,
});

const summary = (over: Partial<SummaryData> = {}): SummaryData => ({
  subtotalMinor: 10_000_000, discountMinor: 0, deliveryFeeMinor: 0, taxMinor: 0, totalMinor: 10_000_000, delivery: null, promotions: { applied: [] }, ...over,
});

describe("PriceSummary", () => {
  it("shows server-calculated totals, with delivery pending until an address is chosen", () => {
    render(<PriceSummary quote={summary()} busy={false} />);
    const region = screen.getByRole("region", { name: "Order summary" });
    expect(within(region).getByText("Items").nextSibling).toHaveTextContent("₦100,000");
    expect(within(region).getByText("Delivery").nextSibling).toHaveTextContent("Calculated at checkout");
    expect(within(region).getByText("Total").nextSibling).toHaveTextContent("₦100,000");
    expect(within(region).queryByText("Tax")).toBeNull();
    expect(region).toHaveAttribute("aria-busy", "false");
  });
  it("lists each applied promotion with its code, and the total saving", () => {
    render(<PriceSummary busy={false} quote={summary({ discountMinor: 1_500_000, totalMinor: 8_500_000, promotions: { applied: [{ promotionId: "a", name: "Welcome", kind: "percentage", code: "WELCOME", discountMinor: 1_000_000 }, { promotionId: "b", name: "Auto", kind: "fixed_amount", code: null, discountMinor: 500_000 }] } })} />);
    expect(screen.getByText("Welcome (WELCOME)").nextSibling).toHaveTextContent("−₦10,000");
    expect(screen.getByText("Auto").nextSibling).toHaveTextContent("−₦5,000");
    expect(screen.getByText(/You’re saving ₦15,000/)).toBeInTheDocument();
  });
  it("shows a delivery fee, or 'Free' when delivery is zero for a chosen method", () => {
    const delivery = { method: "delivery", zoneId: "z", zoneName: "Lagos", baseFeeMinor: 200_000, feeMinor: 200_000, freeDeliveryPromotionId: null, estimate: null } as const;
    const { rerender } = render(<PriceSummary busy={false} quote={summary({ delivery, deliveryFeeMinor: 200_000 })} />);
    expect(screen.getByText("Delivery").nextSibling).toHaveTextContent("₦2,000");
    rerender(<PriceSummary busy={false} quote={summary({ delivery: { ...delivery, feeMinor: 0 }, deliveryFeeMinor: 0 })} />);
    expect(screen.getByText("Delivery").nextSibling).toHaveTextContent("Free");
  });
  it("shows tax only when there is some, and marks itself busy while a new answer loads", () => {
    render(<PriceSummary busy quote={summary({ taxMinor: 750_000, totalMinor: 10_750_000 })} />);
    expect(screen.getByText("Tax").nextSibling).toHaveTextContent("₦7,500");
    expect(screen.getByRole("region", { name: "Order summary" })).toHaveAttribute("aria-busy", "true");
  });
  it("omits the savings banner when nothing is discounted", () => {
    render(<PriceSummary busy={false} quote={summary()} />);
    expect(screen.queryByText(/saving/)).toBeNull();
  });
  it("accepts a custom delivery note", () => {
    render(<PriceSummary busy={false} quote={summary()} deliveryNote="Pick a state" />);
    expect(screen.getByText("Pick a state")).toBeInTheDocument();
  });
});

describe("BagLine", () => {
  const view = (over: Partial<LineView> = {}): LineView => ({ variantId: "v1", quantity: 2, priced: line(), ...over });
  const setup = (v: LineView, busy = false) => {
    const onQuantity = vi.fn();
    const onRemove = vi.fn();
    render(<BagLine view={v} onQuantity={onQuantity} onRemove={onRemove} busy={busy} />);
    return { onQuantity, onRemove };
  };

  it("shows the title as a product link, its options and the server's line total", () => {
    setup(view());
    expect(screen.getByRole("link", { name: "Bone Straight Wig" })).toHaveAttribute("href", "/p/bone-straight");
    expect(screen.getByText('20" · HD')).toBeInTheDocument();
    expect(screen.getByText("₦100,000")).toBeInTheDocument();
  });
  it("strikes through the undiscounted price when a promotion reduced the line", () => {
    setup(view({ priced: line({ lineSubtotalMinor: 10_000_000, lineTotalMinor: 9_000_000, discountMinor: 1_000_000 }) }));
    expect(screen.getByText("₦90,000")).toBeInTheDocument();
    expect(screen.getByText("₦100,000").tagName).toBe("S");
  });
  it("changes quantity with the stepper and removes the line", async () => {
    const { onQuantity, onRemove } = setup(view());
    await userEvent.click(screen.getByRole("button", { name: /Increase quantity/ }));
    expect(onQuantity).toHaveBeenCalledWith("v1", 3);
    await userEvent.click(screen.getByRole("button", { name: /Decrease quantity/ }));
    expect(onQuantity).toHaveBeenLastCalledWith("v1", 1);
    await userEvent.click(screen.getByRole("button", { name: "Remove Bone Straight Wig" }));
    expect(onRemove).toHaveBeenCalledWith("v1");
  });
  it("cannot go above what is in stock, or below one", () => {
    setup(view({ quantity: 5, priced: line({ quantity: 5, availableQuantity: 5 }) }));
    expect(screen.getByRole("button", { name: /Increase quantity/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Decrease quantity/ })).toBeEnabled();
  });
  it("disables decrease at one", () => {
    setup(view({ quantity: 1 }));
    expect(screen.getByRole("button", { name: /Decrease quantity/ })).toBeDisabled();
  });
  it("warns when less stock is left than requested, and offers to use what is left", async () => {
    const { onQuantity } = setup(view({ quantity: 4, problem: { kind: "short", available: 2 } }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only 2 left.");
    await userEvent.click(screen.getByRole("button", { name: "Use 2" }));
    expect(onQuantity).toHaveBeenCalledWith("v1", 2);
  });
  it("tells the shopper an item is gone and hides the stepper", () => {
    setup({ variantId: "v1", quantity: 1, problem: { kind: "gone" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No longer available");
    expect(screen.queryByRole("group", { name: /Quantity/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove This item" })).toBeInTheDocument();
  });
  it("dims the price while a new quote loads", () => {
    setup(view(), true);
    expect(screen.getByText("₦100,000").closest("p")).toHaveAttribute("aria-busy", "true");
  });
});

describe("GiftLine", () => {
  it("shows a free gift with no controls", () => {
    render(<GiftLine line={line({ title: "Silk Scarf", quantity: 1, lineSubtotalMinor: 500_000, lineTotalMinor: 0, gift: { promotionId: "pr" } })} />);
    const gift = screen.getByRole("article", { name: "Free gift: Silk Scarf" });
    expect(within(gift).getByText("Free")).toBeInTheDocument();
    expect(within(gift).getByText("₦5,000").tagName).toBe("S");
    expect(within(gift).getByText(/Qty 1/)).toBeInTheDocument();
    expect(within(gift).queryByRole("button")).toBeNull();
  });
});

describe("CodeEntry", () => {
  beforeEach(() => useCartStore.setState({ lines: [], promotionCodes: [] }));
  const quote = (over: Partial<Quote["promotions"]> = {}) => ({ promotions: { applied: [], rejectedCodes: [], ...over } }) as Quote;
  const box = () => screen.getByRole("textbox", { name: "Promotion code" });

  it("adds an upper-cased code and clears the box", async () => {
    render(<CodeEntry quote={undefined} />);
    await userEvent.type(box(), "  save10 ");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useCartStore.getState().promotionCodes).toEqual(["SAVE10"]);
    expect(box()).toHaveValue("");
    expect(screen.getByText("SAVE10")).toBeInTheDocument();
  });
  it("keeps Apply disabled until there is something to apply", async () => {
    render(<CodeEntry quote={undefined} />);
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    await userEvent.type(box(), "   ");
    expect(apply).toBeDisabled();
    await userEvent.type(box(), "x");
    expect(apply).toBeEnabled();
  });
  it("refuses a duplicate code with a note", async () => {
    useCartStore.setState({ promotionCodes: ["SAVE10"] });
    render(<CodeEntry quote={undefined} />);
    await userEvent.type(box(), "save10{enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("already added");
    expect(useCartStore.getState().promotionCodes).toEqual(["SAVE10"]);
  });
  it("stops at the maximum number of codes", async () => {
    useCartStore.setState({ promotionCodes: Array.from({ length: API_MAX_CODES }, (_, i) => `CODE${i}`) });
    render(<CodeEntry quote={undefined} />);
    await userEvent.type(box(), "ONEMORE{enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(`up to ${API_MAX_CODES}`);
    expect(useCartStore.getState().promotionCodes).toHaveLength(API_MAX_CODES);
  });
  it("marks codes the server applied, and explains the ones it turned down", () => {
    useCartStore.setState({ promotionCodes: ["GOOD", "OLD"] });
    render(<CodeEntry quote={quote({ applied: [{ promotionId: "a", name: "n", kind: "percentage", code: "good", discountMinor: 1 }], rejectedCodes: [{ code: "OLD", reason: "EXPIRED" }] })} />);
    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
  });
  it("removes a code", async () => {
    useCartStore.setState({ promotionCodes: ["SAVE10", "OTHER"] });
    render(<CodeEntry quote={undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove code SAVE10" }));
    expect(useCartStore.getState().promotionCodes).toEqual(["OTHER"]);
  });
  it("clears the note as soon as the shopper edits the box again", async () => {
    useCartStore.setState({ promotionCodes: ["SAVE10"] });
    render(<CodeEntry quote={undefined} />);
    await userEvent.type(box(), "save10{enter}");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.type(box(), "2");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
