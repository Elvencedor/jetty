import { render, screen } from "@testing-library/react";
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
  it("opens the first unanswered step and moves to the next after a choice", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /Length/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Lace/ })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "14 inch" }));
    expect(screen.getByRole("button", { name: /Lace/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Length/ })).toHaveTextContent("14 inch");
  });

  it("flags sold-out values for assistive technology and disables ones that were never made", async () => {
    render(<Harness start={initialSelection(product)} />);
    await userEvent.click(screen.getByRole("button", { name: /Lace/ }));
    // 14 inch × Swiss lace exists but is sold out: still choosable, and announced as sold out.
    expect(screen.getByRole("button", { name: /Swiss lace.*sold out/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /Length/ }));
    await userEvent.click(screen.getByRole("button", { name: "20 inch" }));
    // 20 inch × Swiss lace was never made.
    await userEvent.click(screen.getByRole("button", { name: /Lace/ }));
    expect(screen.getByRole("button", { name: "Swiss lace" })).toBeDisabled();
  });

  it("renders nothing for a product without options", () => {
    const { container } = render(<OptionPicker product={{ options: [], variants: [], defaultVariantId: null }} selection={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
