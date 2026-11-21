import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { DeliveryZone, PrepTime } from "@/lib/api/admin-settings";
import { API, server } from "@/test/server";
import { renderAdmin, signInAdmin, staleResponse } from "@/test/admin";
import { DeliverySection } from "./DeliverySection";
import { PrepTimeSection } from "./PrepTimeSection";

const zone = (over: Partial<DeliveryZone> = {}): DeliveryZone => ({
  id: "z1", name: "Lagos Mainland", scope: "state", state: "Lagos", states: [], areas: [], active: true, timezone: "Africa/Lagos",
  deliveryFeeMinor: 350_000, deliveryMinDays: 1, deliveryMaxDays: 2, pickupEnabled: false, version: 3, ...over,
});
const prep = (over: Partial<PrepTime> = {}): PrepTime => ({ id: "p1", name: "December rush", active: true, mode: "days", days: 7, deliversFrom: null, activeFrom: null, activeUntil: null, appliesTo: "all", zoneIds: [], version: 4, ...over });

beforeEach(() => signInAdmin());

describe("delivery zones: when a save finds the zone changed", () => {
  /** A zone list that answers reads with `current`, and records every edit sent to it. */
  function zonesApi(current: () => DeliveryZone[], respond: (body: { zones: Array<Record<string, unknown>> }, call: number) => Response) {
    const sent: Array<{ zones: Array<Record<string, unknown>> }> = [];
    let reads = 0;
    server.use(
      http.get(`${API}/admin/settings/delivery-zones`, () => { reads++; return HttpResponse.json({ zones: current() }); }),
      http.patch(`${API}/admin/settings/delivery-zones`, async ({ request }) => {
        const body = (await request.json()) as { zones: Array<Record<string, unknown>> };
        sent.push(body);
        return respond(body, sent.length);
      }),
    );
    return { sent, reads: () => reads };
  }

  async function editNameTo(name: string) {
    // The zone is listed twice (table and phone layout); either Edit opens the same drawer.
    await userEvent.click((await screen.findAllByRole("button", { name: /Edit\s*Lagos Mainland/ }))[0]!);
    const field = await screen.findByLabelText("Zone name");
    await userEvent.clear(field);
    await userEvent.type(field, name);
    await userEvent.click(screen.getByRole("button", { name: "Save zone" }));
  }

  it("saves quietly, with no choice, when nobody else got there first", async () => {
    const api = zonesApi(() => [zone()], () => HttpResponse.json({ zones: [zone({ name: "Lagos Mainland 2", version: 4 })] }));
    renderAdmin(<DeliverySection canWrite />);
    await editNameTo("Lagos Mainland 2");
    await waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]!.zones[0]).toMatchObject({ id: "z1", version: 3, name: "Lagos Mainland 2" });
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("offers the choice only after the API refuses the save, and 'keep my changes' saves them on the current version", async () => {
    const api = zonesApi(() => [zone()], (body, call) => (call === 1 ? staleResponse(9) : HttpResponse.json({ zones: [zone({ name: String(body.zones[0]!.name), version: 10 })] })));
    renderAdmin(<DeliverySection canWrite />);
    await editNameTo("Mine");
    expect(await screen.findByText("Someone else changed this zone")).toBeInTheDocument();
    expect(api.sent).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(api.sent).toHaveLength(2));
    expect(api.sent[1]!.zones[0]).toMatchObject({ id: "z1", version: 9, name: "Mine" });
    await waitFor(() => expect(screen.queryByText("Someone else changed this zone")).not.toBeInTheDocument());
  });

  it("'use their version' sends nothing more, drops my edit and shows what is saved now", async () => {
    let saved = zone();
    const api = zonesApi(() => [saved], () => { saved = zone({ name: "Theirs", version: 9 }); return staleResponse(9); });
    renderAdmin(<DeliverySection canWrite />);
    await editNameTo("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    expect((await screen.findAllByText("Theirs")).length).toBeGreaterThan(0);
    expect(api.sent).toHaveLength(1);
    expect(screen.queryByText("Mine")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zone name")).not.toBeInTheDocument();
  });

  it("'keep editing' leaves the form as typed and saves nothing", async () => {
    const api = zonesApi(() => [zone()], () => staleResponse(9));
    renderAdmin(<DeliverySection canWrite />);
    await editNameTo("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this zone")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Zone name")).toHaveValue("Mine");
    expect(api.sent).toHaveLength(1);
  });

  it("shows an ordinary error, not the choice, when the save fails for another reason", async () => {
    zonesApi(() => [zone()], () => HttpResponse.json({ error: { code: "VALIDATION_FAILED", message: "That name is taken.", requestId: "r" } }, { status: 422 }));
    renderAdmin(<DeliverySection canWrite />);
    await editNameTo("Mine");
    expect(await screen.findByRole("alert")).toHaveTextContent("That name is taken.");
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("asks again if the zone changes yet again while the admin is deciding", async () => {
    const api = zonesApi(() => [zone()], (body, call) => (call === 1 ? staleResponse(9) : call === 2 ? staleResponse(12) : HttpResponse.json({ zones: [zone({ version: 13 })] })));
    renderAdmin(<DeliverySection canWrite />);
    await editNameTo("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(api.sent).toHaveLength(2));
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(api.sent).toHaveLength(3));
    expect(api.sent.map((b) => b.zones[0]!.version)).toEqual([3, 9, 12]);
  });

  it("the on/off switch gets the same choice, and keeping mine switches it on the current version", async () => {
    const api = zonesApi(() => [zone({ active: false })], (_body, call) => (call === 1 ? staleResponse(8) : HttpResponse.json({ zones: [zone({ active: true, version: 9 })] })));
    renderAdmin(<DeliverySection canWrite />);
    const [row] = await screen.findAllByRole("switch", { name: "Deliver to Lagos Mainland" });
    await userEvent.click(row!);
    const dialog = await screen.findByText("Someone else changed this zone");
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(api.sent).toHaveLength(2));
    expect(api.sent[1]!.zones[0]).toMatchObject({ id: "z1", version: 8, active: true });
  });
});

describe("prep times: when a save finds the prep time changed", () => {
  function prepApi(respond: (call: number) => Response, current: () => PrepTime[] = () => [prep()]) {
    const sent: Array<{ version: string | null; body: Record<string, unknown> }> = [];
    server.use(
      http.get(`${API}/admin/settings/prep-times`, () => HttpResponse.json({ prepTimes: current() })),
      http.get(`${API}/admin/settings/delivery-zones`, () => HttpResponse.json({ zones: [zone()] })),
      http.patch(`${API}/admin/settings/prep-times/p1`, async ({ request }) => {
        sent.push({ version: request.headers.get("if-match"), body: (await request.json()) as Record<string, unknown> });
        return respond(sent.length);
      }),
    );
    return sent;
  }
  async function rename(name: string) {
    await userEvent.click(await screen.findByRole("button", { name: /Edit\s*December rush/ }));
    const field = await screen.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, name);
    await userEvent.click(screen.getByRole("button", { name: "Save prep time" }));
  }

  it("sends the version it read as If-Match, and shows no choice when it is accepted", async () => {
    const sent = prepApi(() => HttpResponse.json({ prepTimes: [prep({ name: "Boxing Day", version: 5 })] }));
    renderAdmin(<PrepTimeSection canWrite />);
    await rename("Boxing Day");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.version).toBe('"4"');
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("'keep my changes' resends on the version the API named", async () => {
    const sent = prepApi((call) => (call === 1 ? staleResponse(11) : HttpResponse.json({ prepTimes: [prep({ name: "Boxing Day", version: 12 })] })));
    renderAdmin(<PrepTimeSection canWrite />);
    await rename("Boxing Day");
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.version)).toEqual(['"4"', '"11"']);
    expect(sent[1]!.body).toMatchObject({ name: "Boxing Day" });
  });

  it("'use their version' reloads the list and sends nothing more", async () => {
    let list = [prep()];
    const sent = prepApi(() => { list = [prep({ name: "Theirs", version: 11 })]; return staleResponse(11); }, () => list);
    renderAdmin(<PrepTimeSection canWrite />);
    await rename("Mine");
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    expect((await screen.findAllByText("Theirs")).length).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
  });

  it("the on/off switch offers the choice too", async () => {
    const sent = prepApi((call) => (call === 1 ? staleResponse(6) : HttpResponse.json({ prepTimes: [prep({ active: false, version: 7 })] })));
    renderAdmin(<PrepTimeSection canWrite />);
    await userEvent.click(await screen.findByRole("switch", { name: /December rush is on/ }));
    const dialog = await screen.findByText("Someone else changed this prep time");
    expect(within(dialog.closest("dialog")!).getByRole("button", { name: "Keep my changes" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ version: '"6"', body: { active: false } });
  });
});
