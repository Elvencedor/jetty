import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AdminProductDetail, AdminProductRow } from "@/lib/api/admin-catalog";
import { fromDetail, type MatrixDraft } from "@/lib/admin/matrix";
import { OptionCard, parseNairaDifference } from "./OptionCard";
import { ProductCard, productPill } from "./ProductCard";

const row = (over: Partial<AdminProductRow> = {}): AdminProductRow => ({ id: "p1", slug: "s", title: "Bone Straight", status: "active", featured: false, publishedAt: null, updatedAt: "2026-01-01T00:00:00Z", variantCount: 60, availableQuantity: 38, lowStock: false, minPriceMinor: 14_500_000, maxPriceMinor: 33_500_000, coverUrl: null, ...over });

describe("ProductCard", () => {
  it("shows the status, price range, variants and a stock meter, and opens on click", async () => {
    const onOpen = vi.fn();
    render(<ProductCard product={row()} selected={false} onOpen={onOpen} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("60 variants · ₦145k–₦335k")).toBeInTheDocument();
    expect(screen.getByText("38 left")).toHaveClass("text-ink");
    await userEvent.click(screen.getByRole("button", { name: /Bone Straight/ }));
    expect(onOpen).toHaveBeenCalled();
  });
  it("marks low stock in red, and out of stock beats active", () => {
    render(<ProductCard product={row({ availableQuantity: 4 })} selected onOpen={() => {}} />);
    expect(screen.getByText("4 left")).toHaveClass("text-danger");
    expect(productPill({ status: "active", availableQuantity: 0 })).toEqual({ label: "Out of stock", tone: "danger" });
    expect(productPill({ status: "draft", availableQuantity: 0 })).toEqual({ label: "Draft", tone: "neutral" });
    expect(productPill({ status: "archived", availableQuantity: 5 }).label).toBe("Archived");
  });
  it("has a featured star that reports the new state, and none without permission", async () => {
    const toggle = vi.fn();
    const { rerender } = render(<ProductCard product={row({ featured: true })} selected={false} onOpen={() => {}} onToggleFeatured={toggle} />);
    const star = screen.getByRole("button", { name: "Feature Bone Straight on homepage" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(star);
    expect(toggle).toHaveBeenCalledWith(false);
    rerender(<ProductCard product={row()} selected={false} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: /Feature/ })).toBeNull();
  });
});

describe("parseNairaDifference", () => {
  it("reads whole naira, with a sign, as kobo", () => {
    expect(parseNairaDifference("25000")).toBe(2_500_000);
    expect(parseNairaDifference("+25,000")).toBe(2_500_000);
    expect(parseNairaDifference("-10000")).toBe(-1_000_000);
    expect(parseNairaDifference("₦ 5000")).toBe(500_000);
    expect(parseNairaDifference("")).toBe(0);
  });
  it("rejects what is not a number", () => {
    expect(parseNairaDifference("abc")).toBeNull();
    expect(parseNairaDifference("12.5")).toBeNull();
    expect(parseNairaDifference("1".repeat(12))).toBeNull();
  });
});

const detail: AdminProductDetail = {
  product: { id: "p", slug: "s", title: "T", description: null, status: "active", featured: false, badgeOverride: null, seoTitle: null, seoDescription: null, details: null, categoryIds: [], collectionIds: [], updatedAt: "2026-01-01T00:00:00Z" },
  options: [
    { id: "o1", name: "Length", values: [{ id: "a", label: '12"', valueKey: "12", priceDeltaMinor: 0, swatch: null, active: true }, { id: "b", label: '14"', valueKey: "14", priceDeltaMinor: 1_000_000, swatch: null, active: true }] },
    { id: "o2", name: "Lace", values: [{ id: "c", label: "13×4 HD", valueKey: "13x4-hd", priceDeltaMinor: 0, swatch: null, active: true }, { id: "d", label: "4×4 closure", valueKey: "4x4-closure", priceDeltaMinor: -2_000_000, swatch: null, active: true }] },
  ],
  variants: [["12", "13x4-hd", 14_500_000, 3], ["12", "4x4-closure", 12_500_000, 8], ["14", "13x4-hd", 15_500_000, 1], ["14", "4x4-closure", 13_500_000, 2]].map(([l, c, p, n], i) => ({
    id: `v${i}`, sku: `S-${l}-${c}`, optionValues: { Length: l as string, Lace: c as string }, priceMinor: p as number, compareAtPriceMinor: null, active: true, stock: { onHand: n as number, reserved: 0, available: n as number, lowStockThreshold: null },
  })),
  media: [],
};

function Harness({ optionIndex }: { optionIndex: number }) {
  const [draft, setDraft] = useState<MatrixDraft>(() => fromDetail(detail));
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <OptionCard option={draft.options[optionIndex]!} first={optionIndex === 0} draft={draft} skuBase="S" disabled={false} editing={editing} onEdit={setEditing} onChange={setDraft} />
      <output data-testid="count">{draft.variants.length}</output>
      <output data-testid="hidden">{draft.variants.filter((v) => !v.active).length}</output>
    </>
  );
}

describe("OptionCard", () => {
  it("shows values as chips with their price differences, the first option as absolute prices", () => {
    const { unmount } = render(<Harness optionIndex={0} />);
    expect(screen.getByRole("button", { name: 'Edit 14"' })).toHaveTextContent("₦155k");
    expect(screen.getByRole("button", { name: 'Edit 12"' })).not.toHaveTextContent("₦");
    expect(screen.getByText("2 values · sets the base price")).toBeInTheDocument();
    unmount();
    render(<Harness optionIndex={1} />);
    expect(screen.getByRole("button", { name: "Edit 4×4 closure" })).toHaveTextContent("−₦20k");
    expect(screen.getByText("2 values · price difference per lace")).toBeInTheDocument();
  });

  it("adds a value: explains the impact first, then creates the variants", async () => {
    render(<Harness optionIndex={1} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add lace" }));
    const editor = screen.getByRole("group", { name: "New lace" });
    expect(within(editor).getByRole("button", { name: "Add lace" })).toBeDisabled();
    await userEvent.type(within(editor).getByLabelText("Name customers see"), "Full lace 360");
    await userEvent.clear(within(editor).getByLabelText(/Price difference/));
    await userEvent.type(within(editor).getByLabelText(/Price difference/), "45000");
    expect(within(editor).getByText(/Creates 2 new variants, one for every mix of the other options/)).toBeInTheDocument();
    await userEvent.click(within(editor).getByRole("button", { name: "Add lace" }));
    expect(screen.getByTestId("count")).toHaveTextContent("6");
    expect(screen.getByRole("button", { name: "Edit Full lace 360" })).toHaveTextContent("+₦45k");
    expect(screen.queryByRole("group", { name: "New lace" })).toBeNull();
  });

  it("refuses a duplicate, and says why", async () => {
    render(<Harness optionIndex={1} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add lace" }));
    await userEvent.type(screen.getByLabelText("Name customers see"), "13x4 hd");
    await userEvent.click(screen.getByRole("button", { name: "Add lace" }));
    expect(screen.getByRole("alert")).toHaveTextContent("13x4 hd already exists.");
    expect(screen.getByTestId("count")).toHaveTextContent("4");
  });

  it("deletes only after a warning that counts the cost, and can hide instead", async () => {
    render(<Harness optionIndex={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit 4×4 closure" }));
    const editor = screen.getByRole("group", { name: "Edit lace: 4×4 closure" });
    expect(within(editor).getByText(/Used by 2 variants with 10 units in stock/)).toBeInTheDocument();
    await userEvent.click(within(editor).getByRole("button", { name: "Delete" }));
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("This removes 2 variants and 10 units of stock");
    expect(screen.getByRole("button", { name: "Hide it instead" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Hide it instead" }));
    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByTestId("hidden")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Edit 4×4 closure" })).toHaveTextContent("hidden");
  });

  it("deletes for real when confirmed, and warns when a change reprices variants", async () => {
    render(<Harness optionIndex={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit 4×4 closure" }));
    const editor = screen.getByRole("group", { name: "Edit lace: 4×4 closure" });
    await userEvent.clear(within(editor).getByLabelText(/Price difference/));
    await userEvent.type(within(editor).getByLabelText(/Price difference/), "-10000");
    expect(within(editor).getByText(/reprices them by \+₦10,000 each/)).toBeInTheDocument();
    await userEvent.click(within(editor).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: "Edit 4×4 closure" })).toBeNull();
  });
});
