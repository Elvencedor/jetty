import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProductRow, AdminProductStatus } from "@/lib/api/admin-catalog";
import { useToasts } from "@/lib/stores/toast";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin } from "@/test/admin";
import { useSelectionStore } from "@/lib/admin/selection";
import { ProductsPage } from "./ProductsPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/products", useSearchParams: () => new URLSearchParams() }));

const product = (n: number, status: AdminProductStatus = "draft"): AdminProductRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, slug: `wig-${n}`, title: `Wig ${n}`, status, featured: false, tags: [], publishedAt: null, updatedAt: "2026-01-01T00:00:00Z", version: 1,
  variantCount: 2, availableQuantity: 10, lowStock: false, minPriceMinor: 1_000_000, maxPriceMinor: 2_000_000, coverUrl: null, coverObjectKey: null,
} as AdminProductRow);
const id = (n: number) => product(n).id;

type Bulk = { ids: string[]; status: string };
/** A catalogue of 6 products in two pages of 3, a search that narrows it, and a bulk endpoint that records what it is asked. */
function catalogue(opts: { respond?: (body: Bulk, call: number) => Response } = {}) {
  const bulk: Bulk[] = [];
  const pages = { first: [product(1), product(2), product(3, "active")], second: [product(4), product(5), product(6)] };
  server.use(
    http.get(`${API}/admin/products`, ({ request }) => {
      const url = new URL(request.url);
      const q = url.searchParams.get("q");
      if (q) return HttpResponse.json({ data: [product(2)], page: { nextCursor: null }, summary: null });
      const second = url.searchParams.get("cursor") === "page2";
      return HttpResponse.json({ data: second ? pages.second : pages.first, page: { nextCursor: second ? null : "page2" }, summary: second ? null : { products: 6, variants: 12, lowStock: 0 } });
    }),
    http.post(`${API}/admin/products/bulk-status`, async ({ request }) => {
      const body = (await request.json()) as Bulk;
      bulk.push(body);
      return opts.respond ? opts.respond(body, bulk.length) : HttpResponse.json({ status: body.status, requested: body.ids.length, updated: body.ids.map((i) => ({ id: i, version: 2, previousStatus: "draft" })), unchanged: [], skipped: [], missing: [] });
    }),
  );
  return bulk;
}

const tick = (n: number) => screen.getByRole("checkbox", { name: `Select Wig ${n}` });
const bar = () => screen.queryByRole("region", { name: "Bulk actions" });

beforeEach(() => {
  useSelectionStore.setState({ byResource: {} });
  useToasts.setState({ toasts: [] });
  signInAdmin(["catalog:read", "catalog:write"]);
});

async function load() {
  renderAdmin(<ProductsPage />);
  await screen.findByRole("checkbox", { name: "Select Wig 1" });
}

describe("selecting products", () => {
  it("shows nothing about a selection until something is selected, then always shows how many", async () => {
    catalogue();
    await load();
    expect(bar()).not.toBeInTheDocument();
    await userEvent.click(tick(1));
    expect(within(bar()!).getByText("1 product selected")).toBeInTheDocument();
    await userEvent.click(tick(2));
    expect(within(bar()!).getByText("2 products selected")).toBeInTheDocument();
    expect(tick(1)).toBeChecked();
    await userEvent.click(tick(1));
    expect(within(bar()!).getByText("1 product selected")).toBeInTheDocument();
    await userEvent.click(tick(2));
    expect(bar()).not.toBeInTheDocument();
  });

  it("keeps what was selected on the first page when more is loaded, and counts across both", async () => {
    catalogue();
    await load();
    await userEvent.click(tick(1));
    await userEvent.click(tick(2));
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByRole("checkbox", { name: "Select Wig 4" });
    expect(tick(1)).toBeChecked();
    expect(tick(2)).toBeChecked();
    expect(tick(3)).not.toBeChecked();
    await userEvent.click(tick(5));
    expect(within(bar()!).getByText("3 products selected")).toBeInTheDocument();
  });

  it("keeps the selection when a search changes what is shown, and says how many are out of sight", async () => {
    catalogue();
    await load();
    await userEvent.click(tick(1));
    await userEvent.click(tick(2));
    await userEvent.click(tick(3));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search products" }), "wig 2");
    // The list reloads for the search: first Wig 1 goes, then the one match arrives, still ticked.
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select Wig 1" })).not.toBeInTheDocument());
    expect(await screen.findByRole("checkbox", { name: "Select Wig 2" })).toBeChecked();
    expect(within(bar()!).getByText("3 products selected")).toBeInTheDocument();
    expect(within(bar()!).getByText("2 not shown with this search or filter")).toBeInTheDocument();
  });

  it("'select all shown' goes empty, partial, full as the selection changes, and counts only what is shown", async () => {
    catalogue();
    await load();
    const all = () => screen.getByRole("checkbox", { name: /shown/ }) as HTMLInputElement;
    expect(screen.getByText("Select all 3 products shown")).toBeInTheDocument();
    await userEvent.click(tick(1));
    expect(screen.getByText("1 of 3 products shown selected")).toBeInTheDocument();
    expect(all().indeterminate).toBe(true);
    await userEvent.click(all());
    expect(screen.getByText("All 3 products shown selected")).toBeInTheDocument();
    expect([tick(1), tick(2), tick(3)].every((c) => (c as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(all());
    expect(bar()).not.toBeInTheDocument();
  });

  it("'select all shown' after loading more adds the new page without dropping the old", async () => {
    catalogue();
    await load();
    await userEvent.click(screen.getByRole("checkbox", { name: /shown/ }));
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByRole("checkbox", { name: "Select Wig 6" });
    expect(screen.getByText("3 of 6 products shown selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /shown/ }));
    expect(within(bar()!).getByText("6 products selected")).toBeInTheDocument();
  });

  it("selects a range with shift-click", async () => {
    catalogue();
    await load();
    const user = userEvent.setup(); // one user, so the held Shift reaches the second click
    await user.click(tick(1));
    await user.keyboard("{Shift>}");
    await user.click(tick(3));
    await user.keyboard("{/Shift}");
    expect(within(bar()!).getByText("3 products selected")).toBeInTheDocument();
    expect([tick(1), tick(2), tick(3)].every((c) => (c as HTMLInputElement).checked)).toBe(true);
  });

  it("lists everything selected, from every page, in a review list where each can be removed", async () => {
    catalogue();
    await load();
    await userEvent.click(tick(1));
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Wig 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    const list = await screen.findByRole("dialog", { name: "Selected products" });
    expect(within(list).getByText("Wig 1")).toBeInTheDocument();
    expect(within(list).getByText("Wig 5")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Remove Wig 1 from the selection" }));
    expect(within(bar()!).getByText("1 product selected")).toBeInTheDocument();
    expect(tick(1)).not.toBeChecked();
  });

  it("clears the whole selection with one button", async () => {
    catalogue();
    await load();
    await userEvent.click(tick(1));
    await userEvent.click(tick(2));
    await userEvent.click(within(bar()!).getByRole("button", { name: "Clear" }));
    expect(bar()).not.toBeInTheDocument();
    expect(tick(1)).not.toBeChecked();
  });

  it("offers no selection to someone who cannot change the catalogue", async () => {
    signInAdmin(["catalog:read"]);
    catalogue();
    renderAdmin(<ProductsPage />);
    await screen.findByText("Wig 1");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
  });
});

describe("changing the status of the selected products", () => {
  async function selectAcrossPages() {
    await userEvent.click(tick(1));
    await userEvent.click(tick(2));
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Wig 4" }));
  }

  it("asks first, saying how many and what will happen, and sends nothing until confirmed", async () => {
    const bulk = catalogue();
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive 3 products?" });
    expect(within(dialog).getByText(/hidden from shoppers/)).toBeInTheDocument();
    expect(bulk).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(bulk).toHaveLength(0);
    expect(within(bar()!).getByText("3 products selected")).toBeInTheDocument();
  });

  it("sends every selected id, from every page, in ONE request, then clears the selection", async () => {
    const bulk = catalogue();
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish 3" }));
    await waitFor(() => expect(bulk).toHaveLength(1));
    expect(bulk[0]).toEqual({ ids: [id(1), id(2), id(4)], status: "active" });
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(useToasts.getState().toasts.at(-1)?.message).toBe("Published 3 products.");
  });

  it("says what could not be changed and why, keeps those selected, and flags them in the review list", async () => {
    catalogue({
      respond: (body) => HttpResponse.json({
        status: "active", requested: 3,
        updated: [{ id: body.ids[0], version: 2, previousStatus: "draft" }], unchanged: [],
        skipped: [{ id: body.ids[1], title: "Wig 2", code: "NOT_PUBLISHABLE", reason: "It has no active variant. Add one before publishing." }, { id: body.ids[2], title: "Wig 4", code: "NOT_PUBLISHABLE", reason: "It has no active variant. Add one before publishing." }], missing: [],
      }),
    });
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish 3" }));
    const dialog = await screen.findByRole("dialog", { name: "2 could not be changed" });
    expect(within(dialog).getAllByText(/no active variant/)).toHaveLength(2);
    expect(useToasts.getState().toasts.at(-1)?.message).toBe("Published 1 product. 2 could not be changed.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep them selected" }));
    expect(within(bar()!).getByText("2 products selected")).toBeInTheDocument();
    expect(tick(1)).not.toBeChecked();
    expect(tick(2)).toBeChecked();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Review" }));
    const review = await screen.findByRole("dialog", { name: "Selected products" });
    expect(within(review).getAllByText(/no active variant/)).toHaveLength(2);
  });

  it("'clear them' drops the ones that could not be changed", async () => {
    catalogue({ respond: (body) => HttpResponse.json({ status: "active", requested: 3, updated: [], unchanged: [], skipped: body.ids.map((i) => ({ id: i, title: "x", code: "NOT_PUBLISHABLE", reason: "No active variant." })), missing: [] }) });
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish 3" }));
    await userEvent.click(await screen.findByRole("button", { name: "Clear them" }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(useToasts.getState().toasts.at(-1)?.message).toBe("No products were changed. 3 could not be changed.");
  });

  it("offers Undo, which puts each product back to the status it had", async () => {
    const bulk = catalogue({ respond: (body, call) => (call === 1 ? HttpResponse.json({ status: "archived", requested: 3, updated: [{ id: body.ids[0], version: 2, previousStatus: "draft" }, { id: body.ids[1], version: 2, previousStatus: "active" }, { id: body.ids[2], version: 2, previousStatus: "draft" }], unchanged: [], skipped: [], missing: [] }) : HttpResponse.json({ status: body.status, requested: body.ids.length, updated: [], unchanged: [], skipped: [], missing: [] })) });
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Archive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive 3" }));
    await waitFor(() => expect(useToasts.getState().toasts.at(-1)?.action?.label).toBe("Undo"));
    useToasts.getState().toasts.at(-1)!.action!.onClick();
    await waitFor(() => expect(bulk).toHaveLength(3));
    expect(bulk.slice(1)).toEqual(expect.arrayContaining([{ ids: [id(1), id(4)], status: "draft" }, { ids: [id(2)], status: "active" }]));
  });

  it("keeps the selection and shows the error when the request fails", async () => {
    catalogue({ respond: () => HttpResponse.json({ error: { code: "INTERNAL", message: "Boom.", requestId: "r" } }, { status: 500 }) });
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Archive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive 3" }));
    await waitFor(() => expect(useToasts.getState().toasts.at(-1)?.tone).toBe("error"));
    expect(within(bar()!).getByText("3 products selected")).toBeInTheDocument();
  });

  it("takes products that no longer exist, or were already that way, out of the selection with a plain message", async () => {
    catalogue({ respond: (body) => HttpResponse.json({ status: "active", requested: 3, updated: [], unchanged: [body.ids[0]], skipped: [], missing: [body.ids[1], body.ids[2]] }) });
    await load();
    await selectAcrossPages();
    await userEvent.click(within(bar()!).getByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish 3" }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(useToasts.getState().toasts.at(-1)?.message).toBe("No products were changed. 1 product already was that way. 2 products no longer exist.");
  });
});
