import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRow } from "@/lib/api/admin-catalog";
import type { ContentEntry } from "@/lib/api/admin-content";
import type { PromotionDetail } from "@/lib/api/admin-promotions";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin, staleResponse } from "@/test/admin";
import { PromotionBuilder } from "./promotions/PromotionBuilder";
import { EntrySection } from "./storefront/EntrySection";
import { CollectionDrawer } from "./taxonomy/TaxonomyDrawers";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/admin", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  push.mockClear();
  signInAdmin(["catalog:write", "content:read", "content:write", "promotions:read", "promotions:write", "settings:read"]);
});

describe("collection: when a save finds the collection changed", () => {
  const collection: CollectionRow = { id: "k1", name: "Bestsellers", slug: "bestsellers", active: true, description: null, sortOrder: 0, productCount: 0, version: 3 };
  function setup(respond: (call: number) => Response) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(
      http.get(`${API}/admin/collections/k1/products`, () => HttpResponse.json({ data: [] })),
      http.get(`${API}/admin/products`, () => HttpResponse.json({ data: [], page: { nextCursor: null }, summary: null })),
      http.patch(`${API}/admin/collections/k1`, async ({ request }) => {
        sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
        return respond(sent.length);
      }),
    );
    const onSaved = vi.fn();
    renderAdmin(<CollectionDrawer collection={collection} canWrite onClose={() => undefined} onSaved={onSaved} />);
    return { sent, onSaved };
  }
  const rename = async () => {
    const field = await screen.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Top sellers");
    await userEvent.click(screen.getByRole("button", { name: "Save collection" }));
  };

  it("'keep my changes' saves again on the current version", async () => {
    const { sent, onSaved } = setup((call) => (call === 1 ? staleResponse(7) : HttpResponse.json({ ...collection, name: "Top sellers", version: 8 })));
    await rename();
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent.map((s) => s.version)).toEqual(['"3"', '"7"']);
  });

  it("'use their version' sends nothing more", async () => {
    const { sent, onSaved } = setup(() => staleResponse(7));
    await rename();
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
  });
});

describe("promotion: when a save finds the promotion changed", () => {
  const detail = (over: Record<string, unknown> = {}): PromotionDetail => ({
    promotion: { id: "pr1", name: "Ten off", kind: "percentage", status: "draft", lifecycle: "draft", version: 4, configuration: { version: 1, percent: 10 }, scope: {}, startsAt: null, endsAt: null, priority: 0, stackable: false, totalUsageLimit: null, perCustomerLimit: null, usageCount: 0, firstOrderOnly: false, minimumSubtotalMinor: null, ...over },
    gift: null, codes: [], stats: { redemptions: 0, discountMinor: 0, orderRevenueMinor: 0, openHolds: 0 },
  });
  function setup(respond: (call: number) => Response, current: () => PromotionDetail = () => detail()) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(
      http.get(`${API}/admin/promotions/pr1`, () => HttpResponse.json(current())),
      http.get(`${API}/admin/collections`, () => HttpResponse.json({ data: [] })),
      http.get(`${API}/admin/settings/delivery-zones`, () => HttpResponse.json({ zones: [] })),
      http.patch(`${API}/admin/promotions/pr1`, async ({ request }) => {
        sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
        return respond(sent.length);
      }),
    );
    return sent;
  }
  const rename = async () => {
    const field = await screen.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Fifteen off");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  };

  it("'keep my changes' saves again on the current version, then leaves the page", async () => {
    const sent = setup((call) => (call === 1 ? staleResponse(9) : HttpResponse.json(detail({ name: "Fifteen off", version: 10 }))));
    renderAdmin(<PromotionBuilder id="pr1" />);
    await rename();
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.version)).toEqual(['"4"', '"9"']);
    expect(sent[1]!.body).toMatchObject({ name: "Fifteen off" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/promotions"));
  });

  it("'use their version' shows the saved promotion again, with my edit gone", async () => {
    let stored = detail();
    const sent = setup(() => { stored = detail({ name: "Theirs", version: 9 }); return staleResponse(9); }, () => stored);
    renderAdmin(<PromotionBuilder id="pr1" />);
    await rename();
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Theirs"));
    expect(sent).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("content list: when taking an entry down finds it changed", () => {
  const entry = (over: Partial<ContentEntry> = {}): ContentEntry => ({ id: "e1", contentType: "announcement", slug: "free-shipping", title: "Free shipping", body: { text: "Free shipping this week" }, status: "published", startsAt: null, endsAt: null, sortOrder: 0, updatedAt: null, version: 2, image: null, ...over });
  function setup(respond: (call: number) => Response, current: () => ContentEntry[] = () => [entry()]) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(
      http.get(`${API}/admin/content`, () => HttpResponse.json({ data: current(), page: { nextCursor: null } })),
      http.patch(`${API}/admin/content/e1`, async ({ request }) => {
        sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
        return respond(sent.length);
      }),
    );
    return sent;
  }

  it("'keep my changes' takes it down on the current version", async () => {
    const sent = setup((call) => (call === 1 ? staleResponse(6) : HttpResponse.json(entry({ status: "draft", version: 7 }))));
    renderAdmin(<EntrySection type="announcement" canWrite />);
    await userEvent.click(await screen.findByRole("button", { name: /Take down/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.version)).toEqual(['"2"', '"6"']);
    expect(sent[1]!.body).toEqual({ status: "draft" });
  });

  it("'use their version' sends nothing more and shows the list as it is now", async () => {
    let list = [entry()];
    const sent = setup(() => { list = [entry({ title: "Their headline", status: "published", version: 6 })]; return staleResponse(6); }, () => list);
    renderAdmin(<EntrySection type="announcement" canWrite />);
    await userEvent.click(await screen.findByRole("button", { name: /Take down/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Someone else changed this announcement")).not.toBeInTheDocument());
  });
});

describe("reordering: one request, and a choice only when the order itself changed", () => {
  const story = (id: string, label: string, sortOrder: number, over: Partial<ContentEntry> = {}): ContentEntry => ({ id, contentType: "story", slug: id, title: label, body: { title: label, linkUrl: "/x" }, status: "published", startsAt: null, endsAt: null, sortOrder, updatedAt: null, version: 1, image: null, ...over });
  const A = () => story("00000000-0000-4000-8000-00000000000a", "Alpha", 0);
  const B = () => story("00000000-0000-4000-8000-00000000000b", "Bravo", 10);
  const C = () => story("00000000-0000-4000-8000-00000000000c", "Charlie", 20);
  type Put = { contentType: string; ids: string[]; expected: Array<{ id: string; sortOrder: number }> };

  function setup(respond: (call: number, body: Put) => Response, list: () => ContentEntry[] = () => [A(), B(), C()]) {
    const puts: Put[] = [];
    let patches = 0;
    server.use(
      http.get(`${API}/admin/content`, () => HttpResponse.json({ data: list(), page: { nextCursor: null } })),
      http.put(`${API}/admin/content/order`, async ({ request }) => { const body = (await request.json()) as Put; puts.push(body); return respond(puts.length, body); }),
      http.patch(new RegExp(`${API}/admin/content/.+`), () => { patches++; return HttpResponse.json({}); }),
    );
    return { puts, patches: () => patches };
  }
  const moveLater = async (label: string) => userEvent.click(await screen.findByRole("button", { name: `Move ${label} later` }));
  const ok = (puts: Put[]) => HttpResponse.json({ data: puts.at(-1)!.ids.map((id, i) => ({ id, sortOrder: i * 10, version: 2 })) });
  const placesOf = (entries: ContentEntry[]) => entries.map((e) => ({ id: e.id, sortOrder: e.sortOrder }));

  it("moving one entry is a single request carrying the whole new order and the order that was on screen", async () => {
    const api = setup((_call, body) => ok([body]));
    renderAdmin(<EntrySection type="story" canWrite />);
    await moveLater("Alpha");
    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(api.puts[0]).toEqual({ contentType: "story", ids: [B().id, A().id, C().id], expected: placesOf([A(), B(), C()]) });
    expect(api.patches()).toBe(0);
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("when someone else reordered first, 'keep my move' makes the same move on the order that is stored now", async () => {
    // They moved Charlie to the front. I tried to move Alpha later, from the order I had on screen.
    const stored = [story(C().id, "Charlie", 0), story(A().id, "Alpha", 10), story(B().id, "Bravo", 20)];
    const api = setup((call) => (call === 1 ? HttpResponse.json({ error: { code: "PRECONDITION_FAILED", message: "The order changed.", requestId: "r", details: [{ currentOrder: placesOf(stored) }] } }, { status: 412 }) : HttpResponse.json({ data: [] })));
    renderAdmin(<EntrySection type="story" canWrite />);
    await moveLater("Alpha");
    expect(await screen.findByText("Someone else changed this story circle order")).toBeInTheDocument();
    expect(api.puts).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(api.puts).toHaveLength(2));
    // Alpha moves later in THEIR order (Charlie, Alpha, Bravo), not in the stale one.
    expect(api.puts[1]).toEqual({ contentType: "story", ids: [C().id, B().id, A().id], expected: placesOf(stored) });
    await waitFor(() => expect(screen.queryByText("Someone else changed this story circle order")).not.toBeInTheDocument());
  });

  it("'use their version' sends nothing more and shows the order as it is now", async () => {
    let list = [A(), B(), C()];
    const api = setup(() => { list = [story(C().id, "Charlie", 0), story(A().id, "Alpha", 10), story(B().id, "Bravo", 20)]; return HttpResponse.json({ error: { code: "PRECONDITION_FAILED", message: "The order changed.", requestId: "r", details: [{ currentOrder: placesOf(list) }] } }, { status: 412 }); }, () => list);
    renderAdmin(<EntrySection type="story" canWrite />);
    await moveLater("Alpha");
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this story circle order")).not.toBeInTheDocument());
    expect(api.puts).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Move .* later$/ })[0]).toHaveAccessibleName("Move Charlie later"));
  });

  it("'keep editing' leaves the list alone", async () => {
    const api = setup(() => HttpResponse.json({ error: { code: "PRECONDITION_FAILED", message: "The order changed.", requestId: "r", details: [{ currentOrder: placesOf([A(), B(), C()]) }] } }, { status: 412 }));
    renderAdmin(<EntrySection type="story" canWrite />);
    await moveLater("Alpha");
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this story circle order")).not.toBeInTheDocument());
    expect(api.puts).toHaveLength(1);
  });

  it("if the entry was removed by the other person, 'keep my move' says so instead of guessing", async () => {
    const stored = [story(B().id, "Bravo", 0), story(C().id, "Charlie", 10)]; // Alpha is gone
    const api = setup(() => HttpResponse.json({ error: { code: "PRECONDITION_FAILED", message: "The order changed.", requestId: "r", details: [{ currentOrder: placesOf(stored) }] } }, { status: 412 }));
    renderAdmin(<EntrySection type="story" canWrite />);
    await moveLater("Alpha");
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this story circle order")).not.toBeInTheDocument());
    expect(api.puts).toHaveLength(1);
  });

  it("an error that is not a conflict is shown as an error, with no choice", async () => {
    setup(() => HttpResponse.json({ error: { code: "INTERNAL", message: "Boom.", requestId: "r" } }, { status: 500 }));
    renderAdmin(<EntrySection type="story" canWrite />);
    await moveLater("Alpha");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Keep my changes" })).not.toBeInTheDocument());
    expect(screen.queryByText(/order$/)).not.toBeInTheDocument();
  });
});

