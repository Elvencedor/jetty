import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ProductDetail, Variant } from "@/lib/api/types";
import { initialSelection, type Selection } from "@/lib/catalog/variants";
import { OptionPicker } from "./OptionPicker";

const opt = (id: string, name: string, values: [string, string][]) => ({ id, name, values: values.map(([vid, label]) => ({ id: vid, label, valueKey: vid, swatch: null })) });
const variant = (id: string, ids: string[], inStock: boolean): Variant => ({ id, sku: id, price: { amountMinor: 1, currency: "NGN" }, compareAtPrice: null, optionValueIds: ids, availability: { inStock, availableQuantity: inStock ? 3 : 0, lowStock: false } });
const product: Pick<ProductDetail, "options" | "variants" | "defaultVariantId"> = {
  options: [opt("len", "Length", [["l14", "14 inch"], ["l20", "20 inch"]]), opt("lace", "Lace", [["hd", "HD lace"], ["swiss", "Swiss lace"]])],
  variants: [variant("a", ["l14", "hd"], true), variant("b", ["l14", "swiss"], false), variant("c", ["l20", "hd"], true)],
  defaultVariantId: "a",
};

function Harness({ start }: { start?: Selection }) {
  const [selection, setSelection] = useState<Selection>(start ?? {});
  return <OptionPicker product={product} selection={selection} onChange={setSelection} />;
}

describe("OptionPicker", () => {
  it("opens the first unanswered step and, a moment after a choice, the next", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /Length/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Lace/ })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: /^14 inch/ }));
    expect(screen.getByRole("button", { name: /Length/ })).toHaveTextContent("14 inch");
    await waitFor(() => expect(screen.getByRole("button", { name: /Lace/ })).toHaveAttribute("aria-expanded", "true"));
  });

  it("disables values that are sold out or never made, and says so", async () => {
    render(<Harness start={initialSelection(product)} />);
    await userEvent.click(screen.getByRole("button", { name: /Lace/ }));
    // 14 inch × Swiss lace exists but is sold out.
    expect(screen.getByRole("button", { name: "Swiss lace, sold out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^HD lace/ })).toHaveAttribute("aria-pressed", "true");
    // Moving to 20 inch: Swiss lace was never made in that length.
    await userEvent.click(screen.getByRole("button", { name: /Length/ }));
    await userEvent.click(screen.getByRole("button", { name: /^20 inch/ }));
    await userEvent.click(screen.getByRole("button", { name: /Lace/ }));
    expect(screen.getByRole("button", { name: "Swiss lace, sold out" })).toBeDisabled();
  });

  it("notes what a choice adds over the cheapest alternative", async () => {
    const priced = { ...product, variants: [variant("a", ["l14", "hd"], true), variant("b", ["l14", "swiss"], true), variant("c", ["l20", "hd"], true)].map((v, i) => ({ ...v, price: { ...v.price, amountMinor: [20_000_00, 15_000_00, 30_000_00][i]! } })) };
    function Priced() {
      const [selection, setSelection] = useState<Selection>({ len: "l14" });
      return <OptionPicker product={priced} selection={selection} onChange={setSelection} />;
    }
    render(<Priced />);
    // With length answered, the Lace step is the one that opens.
    expect(screen.getByRole("button", { name: /^Swiss lace/ })).toHaveTextContent("Included");
    expect(screen.getByRole("button", { name: /^HD lace/ })).toHaveTextContent("+₦5k");
  });

  it("renders nothing for a product without options", () => {
    const { container } = render(<OptionPicker product={{ options: [], variants: [], defaultVariantId: null }} selection={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
