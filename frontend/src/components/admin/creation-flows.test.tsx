import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin, staleResponse } from "@/test/admin";
import { PrepTimeSection } from "./settings/PrepTimeSection";
import { DeliverySection } from "./settings/DeliverySection";
import { EntryFormPanel } from "./storefront/EntryForm";
import { CategoryDrawer, CollectionDrawer } from "./taxonomy/TaxonomyDrawers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => signInAdmin(["settings:read", "settings:write", "catalog:write", "content:write"]));

type Seen = { ifMatch: string | null; body: Record<string, unknown> };
const record = async (request: Request, into: Seen[]) => { into.push({ ifMatch: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> }); };

/** Creating adds a record that did not exist: nothing to be stale against, so no version is sent and no choice is ever offered. */
describe("creation flows are untouched by version checks", () => {
  it("a new category is created without a version", async () => {
    const seen: Seen[] = [];
    server.use(http.post(`${API}/admin/categories`, async ({ request }) => { await record(request, seen); return HttpResponse.json({ id: "c9", name: "Lace", slug: "lace", parentId: null, sortOrder: 0, active: true, productCount: 0, version: 1 }, { status: 201 }); }));
    const onSaved = vi.fn();
    renderAdmin(<CategoryDrawer category={null} all={[]} canWrite onClose={() => undefined} onSaved={onSaved} />);
    await userEvent.type(await screen.findByLabelText("Name"), "Lace");
    await userEvent.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(seen[0]!.ifMatch).toBeNull();
  });

  it("a new collection is created without a version", async () => {
    const seen: Seen[] = [];
    server.use(
      http.get(`${API}/admin/products`, () => HttpResponse.json({ data: [], page: { nextCursor: null }, summary: null })),
      http.post(`${API}/admin/collections`, async ({ request }) => { await record(request, seen); return HttpResponse.json({ id: "k9", name: "New in", slug: "new-in", active: true, description: null, sortOrder: 0, productCount: 0, version: 1 }, { status: 201 }); }),
    );
    const onSaved = vi.fn();
    renderAdmin(<CollectionDrawer collection={null} canWrite onClose={() => undefined} onSaved={onSaved} />);
    await userEvent.type(await screen.findByLabelText("Name"), "New in");
    await userEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(seen[0]!.ifMatch).toBeNull();
  });

  it("a new content entry is created without a version", async () => {
    const seen: Seen[] = [];
    server.use(http.post(`${API}/admin/content`, async ({ request }) => { await record(request, seen); return HttpResponse.json({ id: "e9", contentType: "announcement", slug: "hi", title: "hi", body: { text: "Hello" }, status: "draft", startsAt: null, endsAt: null, sortOrder: 10, updatedAt: null, version: 1, image: null }, { status: 201 }); }));
    const onDone = vi.fn();
    renderAdmin(<EntryFormPanel type="announcement" entry={null} nextSortOrder={10} onDone={onDone} onCancel={() => undefined} />);
    await userEvent.type(await screen.findByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(seen[0]!.ifMatch).toBeNull();
  });

  it("a new prep time is created without a version", async () => {
    const seen: Seen[] = [];
    server.use(
      http.get(`${API}/admin/settings/prep-times`, () => HttpResponse.json({ prepTimes: [] })),
      http.get(`${API}/admin/settings/delivery-zones`, () => HttpResponse.json({ zones: [] })),
      http.post(`${API}/admin/settings/prep-times`, async ({ request }) => { await record(request, seen); return HttpResponse.json({ prepTimes: [] }); }),
    );
    renderAdmin(<PrepTimeSection canWrite />);
    await userEvent.click(await screen.findByRole("button", { name: "Add prep time" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Rush");
    await userEvent.click(screen.getByRole("button", { name: "Save prep time" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.ifMatch).toBeNull();
    expect(seen[0]!.body).not.toHaveProperty("version");
  });

  it("a new delivery zone is sent with no id and no version", async () => {
    const seen: Array<{ zones: Array<Record<string, unknown>> }> = [];
    server.use(
      http.get(`${API}/admin/settings/delivery-zones`, () => HttpResponse.json({ zones: [] })),
      http.patch(`${API}/admin/settings/delivery-zones`, async ({ request }) => { seen.push((await request.json()) as { zones: Array<Record<string, unknown>> }); return HttpResponse.json({ zones: [] }); }),
    );
    renderAdmin(<DeliverySection canWrite />);
    await userEvent.click((await screen.findAllByRole("button", { name: /Add zone/ }))[0]!);
    await userEvent.type(await screen.findByLabelText("Zone name"), "Ibadan");
    await userEvent.click(await screen.findByRole("combobox", { name: /State/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Oyo" }));
    await userEvent.type(screen.getByLabelText(/Delivery price/), "2500");
    await userEvent.click(screen.getByRole("button", { name: "Save zone" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.zones[0]).not.toHaveProperty("version");
    expect(seen[0]!.zones[0]).not.toHaveProperty("id");
  });

  it("if a create were ever refused with a version error, it is shown as an error and never as the choice", async () => {
    server.use(http.post(`${API}/admin/categories`, () => staleResponse(4)));
    renderAdmin(<CategoryDrawer category={null} all={[]} canWrite onClose={() => undefined} onSaved={() => undefined} />);
    await userEvent.type(await screen.findByLabelText("Name"), "Lace");
    await userEvent.click(screen.getByRole("button", { name: "Create category" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Someone else changed this category")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep my changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use their version" })).not.toBeInTheDocument();
  });
});
