import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow } from "@/lib/api/admin-catalog";
import { useToasts } from "@/lib/stores/toast";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin } from "@/test/admin";
import { useSelectionStore } from "@/lib/admin/selection";
import { TaxonomyPage } from "./TaxonomyPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/products/organise", useSearchParams: () => new URLSearchParams() }));

const cat = (n: number, active = true, parentId: string | null = null): CategoryRow => ({ id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `Cat ${n}`, slug: `cat-${n}`, parentId, sortOrder: n, active, productCount: n, version: 1 });
const id = (n: number) => cat(n).id;
type Bulk = { ids: string[]; active: boolean };

function setup(respond?: (body: Bulk) => Response) {
  const calls: Bulk[] = [];
  const list = [cat(1), cat(2, false), cat(3), cat(4)];
  server.use(
    http.get(`${API}/admin/categories`, () => HttpResponse.json({ data: list })),
    http.get(`${API}/admin/collections`, () => HttpResponse.json({ data: [] })),
    http.post(`${API}/admin/categories/bulk-status`, async ({ request }) => {
      const body = (await request.json()) as Bulk;
      calls.push(body);
      return respond ? respond(body) : HttpResponse.json({ active: body.active, requested: body.ids.length, updated: body.ids.map((i) => ({ id: i, version: 2, previousActive: !body.active })), unchanged: [], skipped: [], missing: [] });
    }),
  );
  return calls;
}
const tick = (n: number) => screen.getByRole("checkbox", { name: `Select Cat ${n}` });
const bar = () => screen.queryByRole("region", { name: "Bulk actions" });
async function load() {
  renderAdmin(<TaxonomyPage />);
  await screen.findByRole("checkbox", { name: "Select Cat 1" });
}

beforeEach(() => {
  useSelectionStore.setState({ byResource: {} });
  useToasts.setState({ toasts: [] });
  signInAdmin(["catalog:read", "catalog:write"]);
});

describe("selecting categories", () => {
  it("shows how many are selected, and the select-all box reflects it", async () => {
    setup();
    await load();
    expect(bar()).not.toBeInTheDocument();
    await userEvent.click(tick(1));
    await userEvent.click(tick(3));
    expect(within(bar()!).getByText("2 categories selected")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 categories shown selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /shown/ }));
    expect(within(bar()!).getByText("4 categories selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /shown/ }));
    expect(bar()).not.toBeInTheDocument();
  });

  it("keeps the selection when the list is refreshed", async () => {
    setup();
    await load();
    await userEvent.click(tick(2));
    await userEvent.click(tick(4));
    renderAdmin(<TaxonomyPage />); // a second view of the same selection, as after navigating away and back
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: "Select Cat 2" })).toHaveLength(2));
    for (const box of screen.getAllByRole("checkbox", { name: "Select Cat 4" })) expect(box).toBeChecked();
  });

  it("offers no selection to someone who cannot change the catalogue", async () => {
    signInAdmin(["catalog:read"]);
    setup();
    renderAdmin(<TaxonomyPage />);
    await screen.findAllByText("Cat 1");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("showing and hiding the selected categories", () => {
  it("asks first, then sends every selected id in one request", async () => {
    const calls = setup();
    await load();
    await userEvent.click(tick(1));
    await userEvent.click(tick(3));
    await userEvent.click(within(bar()!).getByRole("button", { name: "Hide" }));
    const dialog = await screen.findByRole("dialog", { name: "Hide 2 categories?" });
    expect(within(dialog).getByText(/products and sub-categories stay/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hide 2" }));
    await waitFor(() => expect(calls).toEqual([{ ids: [id(1), id(3)], active: false }]));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(useToasts.getState().toasts.at(-1)?.message).toBe("Hid 2 categories.");
  });

  it("shows hidden ones again, and Undo puts back what was changed", async () => {
    const calls = setup();
    await load();
    await userEvent.click(tick(2));
    await userEvent.click(within(bar()!).getByRole("button", { name: "Show" }));
    await userEvent.click(await screen.findByRole("button", { name: "Show 1" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ ids: [id(2)], active: true });
    const undo = await waitFor(() => { const a = useToasts.getState().toasts.at(-1)?.action; expect(a?.label).toBe("Undo"); return a!; });
    undo.onClick();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ ids: [id(2)], active: false });
  });

  it("takes out of the selection what was already that way, and says so", async () => {
    setup((body) => HttpResponse.json({ active: body.active, requested: body.ids.length, updated: [], unchanged: body.ids, skipped: [], missing: [] }));
    await load();
    await userEvent.click(tick(2));
    await userEvent.click(within(bar()!).getByRole("button", { name: "Hide" }));
    await userEvent.click(await screen.findByRole("button", { name: "Hide 1" }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(useToasts.getState().toasts.at(-1)?.message).toBe("No categories were changed. 1 category already was that way.");
  });
});
