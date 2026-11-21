import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProductDetail } from "@/lib/api/admin-catalog";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin, staleResponse } from "@/test/admin";
import { ProductDrawer } from "./ProductDrawer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/products", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => signInAdmin(["catalog:read", "catalog:write"]));

const product = (over: Record<string, unknown> = {}): AdminProductDetail => ({
  product: { id: "p1", slug: "bone-straight", title: "Bone Straight", description: null, status: "active", featured: false, badgeOverride: null, tags: [], seoTitle: null, seoDescription: null, details: null, categoryIds: [], collectionIds: [], updatedAt: "2026-01-01T00:00:00Z", version: 5, ...over },
  options: [], variants: [], media: [],
});
const withTag = (detail: AdminProductDetail) => HttpResponse.json(detail, { headers: { ETag: `"${detail.product.version}"` } });

/** A product API whose stored copy can be changed by "someone else" at any point, and which records each edit sent. */
function productApi(stored: { current: AdminProductDetail }, respond: (call: number, sent: { version: string | null; body: Record<string, unknown> }) => Response | null) {
  const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
  server.use(
    http.get(`${API}/admin/products/p1`, () => withTag(stored.current)),
    http.get(`${API}/admin/categories`, () => HttpResponse.json({ data: [] })),
    http.patch(`${API}/admin/products/p1`, async ({ request }) => {
      const entry = { version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> };
      sent.push(entry);
      return respond(sent.length, entry) ?? withTag(stored.current);
    }),
  );
  return sent;
}

async function retitle(title: string) {
  const field = await screen.findByLabelText("Title");
  await userEvent.clear(field);
  await userEvent.type(field, title);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("product editor: when a save finds the product changed", () => {
  it("saves quietly, with no choice, when nobody else got there first", async () => {
    const stored = { current: product() };
    const sent = productApi(stored, () => { stored.current = product({ title: "Mine", version: 6 }); return null; });
    renderAdmin(<ProductDrawer productId="p1" onClose={() => undefined} canWrite />);
    await retitle("Mine");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.version).toBe('"5"');
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("asks whenever the API refuses on the version, however small the other change was: the API decides, not the page", async () => {
    const stored = { current: product() };
    const sent = productApi(stored, () => { stored.current = product({ featured: true, version: 8 }); return staleResponse(8); }); // they only starred it
    renderAdmin(<ProductDrawer productId="p1" onClose={() => undefined} canWrite />);
    await retitle("Mine");
    expect(await screen.findByText("Someone else changed this product")).toBeInTheDocument();
    expect(sent).toHaveLength(1);
  });

  it("'keep my changes' saves my name over theirs, on the version that is there now", async () => {
    const stored = { current: product() };
    const sent = productApi(stored, (call) => {
      if (call === 1) { stored.current = product({ title: "Theirs", version: 8 }); return staleResponse(8); }
      stored.current = product({ title: "Mine", version: 9 });
      return null;
    });
    renderAdmin(<ProductDrawer productId="p1" onClose={() => undefined} canWrite />);
    await retitle("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.version)).toEqual(['"5"', '"8"']);
    expect(sent[1]!.body).toEqual({ title: "Mine" });
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Mine"));
    expect(screen.queryByText("Someone else changed this product")).not.toBeInTheDocument();
  });

  it("'use their version' drops my edit and shows theirs, sending nothing more", async () => {
    const stored = { current: product() };
    const sent = productApi(stored, () => { stored.current = product({ title: "Theirs", version: 8 }); return staleResponse(8); });
    renderAdmin(<ProductDrawer productId="p1" onClose={() => undefined} canWrite />);
    await retitle("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Theirs"));
    expect(sent).toHaveLength(1);
    expect(screen.queryByText("Someone else changed this product")).not.toBeInTheDocument();
  });

  it("'keep editing' leaves my edit in the form and saves nothing", async () => {
    const stored = { current: product() };
    const sent = productApi(stored, () => { stored.current = product({ title: "Theirs", version: 8 }); return staleResponse(8); });
    renderAdmin(<ProductDrawer productId="p1" onClose={() => undefined} canWrite />);
    await retitle("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this product")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Title")).toHaveValue("Mine");
    expect(sent).toHaveLength(1);
  });

  it("an error that is not a conflict shows as an error, with no choice", async () => {
    const stored = { current: product() };
    productApi(stored, () => HttpResponse.json({ error: { code: "SLUG_TAKEN", message: "Another product already uses this slug.", requestId: "r" } }, { status: 409 }));
    renderAdmin(<ProductDrawer productId="p1" onClose={() => undefined} canWrite />);
    await retitle("Mine");
    expect(await screen.findByRole("alert")).toHaveTextContent("Another product already uses this slug.");
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });
});
