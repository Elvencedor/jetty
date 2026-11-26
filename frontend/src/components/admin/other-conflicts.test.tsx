import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow } from "@/lib/api/admin-catalog";
import type { ContentEntry } from "@/lib/api/admin-content";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin, staleResponse } from "@/test/admin";
import { PoliciesForm } from "./settings/SettingForms";
import { EntryFormPanel } from "./storefront/EntryForm";
import { CategoryDrawer } from "./taxonomy/TaxonomyDrawers";

beforeEach(() => signInAdmin(["settings:read", "settings:write", "catalog:write", "content:write"]));

const category = (over: Partial<CategoryRow> = {}): CategoryRow => ({ id: "c1", name: "Frontals", slug: "frontals", parentId: null, sortOrder: 0, active: true, productCount: 2, version: 6, ...over });

describe("category: when a save finds the category changed", () => {
  function setup(respond: (call: number) => Response) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(http.patch(`${API}/admin/categories/c1`, async ({ request }) => {
      sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
      return respond(sent.length);
    }));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderAdmin(<CategoryDrawer category={category()} all={[category()]} canWrite onClose={onClose} onSaved={onSaved} />);
    return { sent, onSaved, onClose };
  }
  const rename = async (name: string) => {
    const field = await screen.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, name);
    await userEvent.click(screen.getByRole("button", { name: "Save category" }));
  };

  it("sends the version it read, and shows no choice when it is accepted", async () => {
    const { sent, onSaved } = setup(() => HttpResponse.json(category({ name: "Lace", version: 7 })));
    await rename("Lace");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent[0]!.version).toBe('"6"');
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("'keep my changes' saves again on the current version and finishes", async () => {
    const { sent, onSaved } = setup((call) => (call === 1 ? staleResponse(9) : HttpResponse.json(category({ name: "Lace", version: 10 }))));
    await rename("Lace");
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent.map((s) => s.version)).toEqual(['"6"', '"9"']);
    expect(sent[1]!.body).toMatchObject({ name: "Lace" });
  });

  it("'use their version' closes the drawer so the list shows theirs, and sends nothing more", async () => {
    const { sent, onSaved } = setup(() => staleResponse(9));
    await rename("Lace");
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
  });

  it("'keep editing' leaves the drawer open with my edit", async () => {
    const { sent, onSaved, onClose } = setup(() => staleResponse(9));
    await rename("Lace");
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this category")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Name")).toHaveValue("Lace");
    expect(sent).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("settings: when a save finds the setting changed", () => {
  function setup(respond: (call: number) => Response, reads: () => { value: object; version: number }) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(
      http.get(`${API}/admin/settings/policies`, () => { const r = reads(); return HttpResponse.json(r.value, { headers: { ETag: `"${r.version}"` } }); }),
      http.patch(`${API}/admin/settings/policies`, async ({ request }) => {
        sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
        return respond(sent.length);
      }),
    );
    return sent;
  }
  const change = async () => {
    await userEvent.type(await screen.findByLabelText("Pay on delivery limit"), "14000");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  };

  it("sends the version from the ETag it read", async () => {
    const sent = setup(() => HttpResponse.json({ podMaxOrderMinor: 1_400_000 }, { headers: { ETag: '"4"' } }), () => ({ value: { podMaxOrderMinor: null }, version: 3 }));
    renderAdmin(<PoliciesForm canWrite />);
    await change();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.version).toBe('"3"');
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("'keep my changes' sends the same change on the current version, and the form shows it saved", async () => {
    const sent = setup((call) => (call === 1 ? staleResponse(8) : HttpResponse.json({ podMaxOrderMinor: 1_400_000 }, { headers: { ETag: '"9"' } })), () => ({ value: { podMaxOrderMinor: null }, version: 3 }));
    renderAdmin(<PoliciesForm canWrite />);
    await change();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.version)).toEqual(['"3"', '"8"']);
    expect(sent[1]!.body).toMatchObject({ podMaxOrderMinor: 1_400_000 });
    expect(sent[1]!.body).toEqual(sent[0]!.body);
    await waitFor(() => expect(screen.queryByText("Someone else changed this setting")).not.toBeInTheDocument());
  });

  it("'use their version' reads the setting again and shows theirs", async () => {
    let stored = { podMaxOrderMinor: null as number | null };
    const sent = setup(() => { stored = { podMaxOrderMinor: 3_000_000 }; return staleResponse(8); }, () => ({ value: stored, version: stored.podMaxOrderMinor === null ? 3 : 8 }));
    renderAdmin(<PoliciesForm canWrite />);
    await change();
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(screen.getByLabelText("Pay on delivery limit")).toHaveValue("30,000"));
    expect(sent).toHaveLength(1);
  });
});

describe("content entry: when a save finds the entry changed", () => {
  const entry: ContentEntry = { id: "e1", contentType: "announcement", slug: "free-shipping", title: "Free shipping", body: { text: "Free shipping this week" }, status: "draft", startsAt: null, endsAt: null, sortOrder: 0, updatedAt: null, version: 2, image: null };
  function setup(respond: (call: number) => Response) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(http.patch(`${API}/admin/content/e1`, async ({ request }) => {
      sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
      return respond(sent.length);
    }));
    const onDone = vi.fn();
    const onCancel = vi.fn();
    renderAdmin(<EntryFormPanel type="announcement" entry={entry} nextSortOrder={10} onDone={onDone} onCancel={onCancel} />);
    return { sent, onDone, onCancel };
  }
  const edit = async () => {
    const field = await screen.findByLabelText("Message");
    await userEvent.clear(field);
    await userEvent.type(field, "Free shipping all month");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  };

  it("'keep my changes' saves the edit on the current version", async () => {
    const { sent, onDone } = setup((call) => (call === 1 ? staleResponse(5) : HttpResponse.json({ ...entry, version: 6 })));
    await edit();
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(sent.map((s) => s.version)).toEqual(['"2"', '"5"']);
    expect(JSON.stringify(sent[1]!.body)).toContain("Free shipping all month");
  });

  it("'use their version' leaves the form without saving", async () => {
    const { sent, onDone, onCancel } = setup(() => staleResponse(5));
    await edit();
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("an error that is not a conflict shows as an error, with no choice", async () => {
    setup(() => HttpResponse.json({ error: { code: "VALIDATION_FAILED", message: "The message is too long.", requestId: "r" } }, { status: 422 }));
    await edit();
    expect(await screen.findByRole("alert")).toHaveTextContent("The message is too long.");
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });
});
