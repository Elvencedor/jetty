import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ProductCard as Card } from "@/lib/api/types";
import { useWishlistStore } from "@/lib/stores/wishlist";
import { priceLabel, ProductCard } from "./ProductCard";

const product = (over: Partial<Card> = {}): Card => ({
  id: "p1", slug: "bone-straight", title: "Bone Straight Wig", badge: null, badges: [], colours: [{ label: "Black", valueKey: "black", swatch: "#111" }],
  lengthRange: { min: 14, max: 20 }, featured: false, price: { minAmountMinor: 18_000_000, maxAmountMinor: 24_000_000, compareAtMinor: null, currency: "NGN" },
  inStock: true, onOffer: false, rating: { average: 4.8, count: 12 }, image: null, ...over,
});

describe("priceLabel", () => {
  it("shows one price, or the lowest with 'From'", () => {
    expect(priceLabel({ minAmountMinor: 9_500_000, maxAmountMinor: 9_500_000, compareAtMinor: null, currency: "NGN" })).toBe("₦95,000");
    expect(priceLabel(product().price)).toBe("From ₦180,000");
  });
});

describe("ProductCard", () => {
  it("links the title to the product page and shows price, rating and colours", () => {
    render(<ProductCard product={product()} />);
    expect(screen.getByRole("link", { name: "Bone Straight Wig" })).toHaveAttribute("href", "/p/bone-straight");
    expect(screen.getByText("From ₦180,000")).toBeInTheDocument();
    expect(screen.getByLabelText(/Rated 4.8 out of 5 from 12 reviews/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Colours: Black" })).toBeInTheDocument();
  });

  it("marks a sold-out product and keeps its price", () => {
    render(<ProductCard product={product({ inStock: false, badges: [{ kind: "sale", label: "-10%" }] })} />);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.queryByText("-10%")).toBeNull();
    expect(screen.getByText("From ₦180,000")).toBeInTheDocument();
  });

  it("shows the first badge otherwise, and uses the requested heading level", () => {
    render(<ProductCard product={product({ badges: [{ kind: "sale", label: "-10%" }] })} heading="h2" />);
    expect(screen.getByText("-10%")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Bone Straight Wig" })).toBeInTheDocument();
  });

  it("shows the struck-through was price for a sale item", () => {
    render(<ProductCard product={product({ price: { minAmountMinor: 18_500_000, maxAmountMinor: 18_500_000, compareAtMinor: 21_500_000, currency: "NGN" } })} />);
    expect(screen.getByText("₦215,000")).toBeInTheDocument();
    expect(screen.getByText("Was")).toBeInTheDocument();
  });

  it("saves to the local wishlist from the heart without following the link", async () => {
    useWishlistStore.setState({ slugs: [] });
    render(<ProductCard product={product()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save Bone Straight Wig" }));
    expect(useWishlistStore.getState().slugs).toEqual(["bone-straight"]);
  });

  it("the framed pick shows reviews and a plus that leads to the options", () => {
    render(<ProductCard product={product()} layout="pick" />);
    expect(screen.getByText("★ 4.8 · 12 reviews")).toBeInTheDocument();
  });

  it("the list layout carries the rating and lengths, with no heart", () => {
    render(<ProductCard product={product()} layout="list" />);
    expect(screen.getByText('★ 4.8 · 14–20"')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });
});
