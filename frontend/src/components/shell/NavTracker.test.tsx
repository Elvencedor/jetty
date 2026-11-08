import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let path = "/shop/frontal";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

describe("NavTracker", () => {
  it("knows a shopper has moved around the site only after the page changes", async () => {
    const { NavTracker, hasNavigatedWithinSite } = await import("./NavTracker");
    const { rerender } = render(<NavTracker />);
    // Landing on a page is not a navigation: there is nowhere in the site to go back to yet.
    expect(hasNavigatedWithinSite()).toBe(false);

    path = "/p/classic-bob-wig";
    rerender(<NavTracker />);
    expect(hasNavigatedWithinSite()).toBe(true);
  });
});
