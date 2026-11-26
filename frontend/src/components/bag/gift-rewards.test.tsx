import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GiftOffer } from "@/lib/api/types";
import { giftAction, giftHeadline, giftLink, giftUrgency } from "@/lib/cart/gifts";
import { GiftRewards } from "./GiftRewards";

type Over = Partial<Omit<GiftOffer, "needs">> & { needs?: Partial<GiftOffer["needs"]> };
const offer = ({ needs, ...over }: Over = {}): GiftOffer => ({
  promotionId: "a", name: "Free bonnet", status: "locked", firstOrderOnly: false,
  gift: { variantId: "v", slug: "bonnet", title: "Silk Bonnet", optionSummary: "Champagne", image: null, quantity: 1, valueMinor: 1_200_000 },
  minimumSubtotalMinor: 25_000_000, eligibleSubtotalMinor: 18_000_000,
  qualifying: { allProducts: true, collections: [], products: [] }, endsAt: null, leftCount: null, ...over,
  needs: { signIn: false, qualifyingItem: false, spendMinor: 7_000_000, ...needs },
});
const earned = (id = "e") => offer({ promotionId: id, status: "unlocked", needs: { spendMinor: 0 } });
const bobs = { allProducts: false, collections: [{ slug: "bob-wigs", name: "Bob wigs" }], products: [] };

afterEach(() => vi.useRealTimers());

describe("gift wording", () => {
  it("leads with how close the next gift is", () => {
    expect(giftHeadline([offer()]).title).toBe("You’re ₦70,000 away from a free gift");
    expect(giftHeadline([earned(), offer()])).toEqual({ title: "You’re ₦70,000 away from another free gift", note: "1 free gift is already in your order." });
    expect(giftHeadline([offer({ needs: { qualifyingItem: true } })]).title).toBe("Unlock a free gift");
    expect(giftHeadline([offer({ needs: { signIn: true, spendMinor: 0 } })]).title).toBe("A free gift is waiting for you");
    expect(giftHeadline([earned()]).title).toBe("You’ve unlocked a free gift!");
    expect(giftHeadline([earned("1"), earned("2")]).title).toBe("You’ve unlocked 2 free gifts!");
  });

  it("says the one thing to do next", () => {
    expect(giftAction(offer())).toBe("Add ₦70,000 more to get it free");
    expect(giftAction(offer({ qualifying: bobs }))).toBe("Add ₦70,000 more of Bob wigs to get it free");
    expect(giftAction(offer({ qualifying: bobs, needs: { qualifyingItem: true, spendMinor: 0 } }))).toBe("Add Bob wigs to get it free");
    expect(giftAction(offer({ qualifying: bobs, needs: { qualifyingItem: true } }))).toBe("Spend ₦70,000 on Bob wigs to get it free");
    expect(giftAction(offer({ needs: { signIn: true, spendMinor: 0 } }))).toBe("Sign in to claim it");
  });

  it("links to what counts, or to signing in when that is all that is left", () => {
    expect(giftLink(offer(), "/bag")).toEqual({ href: "/shop", label: "Add more items" });
    expect(giftLink(offer({ qualifying: bobs }), "/bag")).toEqual({ href: "/shop/bob-wigs", label: "Shop Bob wigs" });
    expect(giftLink(offer({ qualifying: { allProducts: false, collections: [], products: [{ slug: "bob", title: "Bob" }] } }), "/bag").href).toBe("/p/bob");
    expect(giftLink(offer({ needs: { signIn: true, spendMinor: 0 } }), "/checkout").href).toBe("/account/sign-in?next=%2Fcheckout");
  });

  it("mentions only real urgency", () => {
    const now = Date.parse("2026-11-26T10:00:00Z");
    expect(giftUrgency(offer(), now)).toEqual([]);
    expect(giftUrgency(offer({ endsAt: "2026-11-26T15:12:00Z", leftCount: 2 }), now)).toEqual(["Ends in 5h 12m", "Only 2 left"]);
    expect(giftUrgency(offer({ endsAt: "2026-12-20T10:00:00Z" }), now)).toEqual(["Ends 20 Dec 2026"]);
    expect(giftUrgency(offer({ endsAt: "2026-11-25T10:00:00Z" }), now)).toEqual([]);
  });
});

describe("GiftRewards", () => {
  it("shows nothing without offers", () => {
    const { container, rerender } = render(<GiftRewards offers={undefined} busy={false} returnTo="/bag" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<GiftRewards offers={[]} busy={false} returnTo="/bag" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows progress to a locked gift and the way to earn it", () => {
    render(<GiftRewards offers={[offer()]} busy={false} returnTo="/checkout" leaveNote="Your delivery details are saved." />);
    const card = screen.getByRole("region", { name: /away from a free gift/ });
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "₦180,000 of ₦250,000");
    expect(within(card).getByRole("link", { name: "Add more items" })).toHaveAttribute("href", "/shop");
    expect(within(card).getByText("Your delivery details are saved.")).toBeInTheDocument();
  });

  it("confirms an earned gift with nothing left to do", () => {
    render(<GiftRewards offers={[earned()]} busy={false} returnTo="/bag" />);
    expect(screen.getByText("Unlocked")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("asks a guest to sign in as well when there is still something to add", () => {
    render(<GiftRewards offers={[offer({ firstOrderOnly: true, needs: { signIn: true } })]} busy={false} returnTo="/bag" />);
    expect(screen.getByText(/For first orders only/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "sign in" })).toHaveAttribute("href", "/account/sign-in?next=%2Fbag");
  });

  it("keeps further gifts behind a button", async () => {
    render(<GiftRewards offers={[offer(), offer({ promotionId: "b", gift: { ...offer().gift, title: "Wig Stand" } })]} busy={false} returnTo="/bag" />);
    expect(screen.getByText("Wig Stand")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "See 1 more gift" }));
    expect(screen.getByText("Wig Stand")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show fewer gifts" })).toHaveAttribute("aria-expanded", "true");
  });

  it("drops an offer when it ends while the page is open", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-26T10:00:00Z") });
    render(<GiftRewards offers={[offer({ endsAt: "2026-11-26T10:00:20Z" })]} busy={false} returnTo="/bag" />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(31_000));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
