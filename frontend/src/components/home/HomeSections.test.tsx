import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HomeSection } from "@/lib/api/types";
import { HomeSections } from "./HomeSections";

const length: HomeSection = {
  type: "length",
  title: "Shop by length",
  items: [
    { label: '10–14"', hint: "Shoulder", lengths: [10, 12, 14] },
    { label: '30"+', hint: "Thigh", lengths: [30, 32] },
  ],
} as HomeSection;

describe("HomeSections: shop by length", () => {
  it("links each length card to the shop filtered by those lengths", () => {
    render(<HomeSections sections={[length]} now={0} />);
    const list = within(screen.getByRole("region", { name: "Shop by length" })).getByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/shop?length=10,12,14", "/shop?length=30,32"]);
    expect(links[0]).toHaveAccessibleName('10–14" wigs, Shoulder length');
  });

  it("shows the label as given, without doubling the inch mark", () => {
    render(<HomeSections sections={[length]} now={0} />);
    expect(screen.getByText('10–14"')).toBeInTheDocument();
    expect(screen.queryByText('10–14""')).not.toBeInTheDocument();
  });

  it("offers a See all link to the whole shop", () => {
    render(<HomeSections sections={[length]} now={0} />);
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/shop");
  });

  it("renders nothing when there are no lengths", () => {
    render(<HomeSections sections={[{ ...length, items: [] } as HomeSection]} now={0} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
