import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { API, server } from "@/test/server";
import { useAdminSession, useCustomerSession } from "@/lib/stores/session";
import { useSessionHints } from "@/lib/stores/session-hint";
import { apiFetch, apiRequest, ApiError, isApiError, refreshAccessToken, withQuery } from "./client";

const session = (token = "tok-1", name = "customer") => ({ accessToken: token, tokenType: "Bearer", expiresIn: 900, [name]: name === "customer" ? { id: "c1", phone: "+2348031234567", email: null, emailVerified: false, phoneVerified: true, createdAt: "2026-01-01T00:00:00Z" } : { id: "a1", email: "a@x.com", roles: ["owner"], permissions: ["*"] } });
const signIn = (token = "tok-1") => useCustomerSession.getState().setSession({ accessToken: token, expiresIn: 900, user: session().customer as never });
const unauthorized = () => HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required.", requestId: "req_1" } }, { status: 401 });

describe("requests and responses", () => {
  it("returns the parsed body and builds the URL from the base and path", async () => {
    server.use(http.get(`${API}/products/x`, () => HttpResponse.json({ data: { slug: "x" } })));
    expect(await apiFetch("/products/x")).toEqual({ data: { slug: "x" } });
    expect(await apiFetch("products/x")).toEqual({ data: { slug: "x" } });
  });

  it("sends JSON bodies with the contract headers, and exposes the ETag", async () => {
    let seen: Request | undefined;
    server.use(
      http.patch(`${API}/admin/products/1`, ({ request }) => {
        seen = request;
        return HttpResponse.json({ ok: true }, { headers: { ETag: '"123"' } });
      }),
    );
    const result = await apiRequest("/admin/products/1", { method: "PATCH", body: { title: "T" }, idempotencyKey: "k-1234567890123456", ifMatch: '"122"' });
    expect(seen!.headers.get("content-type")).toBe("application/json");
    expect(seen!.headers.get("idempotency-key")).toBe("k-1234567890123456");
    expect(seen!.headers.get("if-match")).toBe('"122"');
    expect(result.etag).toBe('"123"');
    expect(await seen!.clone().json()).toEqual({ title: "T" });
  });

  it("sends cookies to the API's own origin from the browser", async () => {
    server.use(http.get(`${API}/c`, () => HttpResponse.json({})));
    const spy = vi.spyOn(globalThis, "fetch");
    await apiFetch("/c");
    expect(spy.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("handles an empty 204 body", async () => {
    server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })));
    const result = await apiRequest("/auth/logout", { method: "POST" });
    expect([result.status, result.data]).toEqual([204, null]);
  });

  it("builds query strings: skips empty values, repeats arrays, encodes", () => {
    expect(withQuery("/products", { q: "26 inch", limit: 20, inStock: true, cursor: undefined, sort: "", length: ["14", "20"], onOffer: false })).toBe("/products?q=26+inch&limit=20&inStock=true&length=14&length=20&onOffer=false");
    expect(withQuery("/x?a=1", { b: 2 })).toBe("/x?a=1&b=2");
    expect(withQuery("/x", {})).toBe("/x");
    expect(withQuery("/x")).toBe("/x");
  });
});

describe("errors", () => {
  it("turns the API's error envelope into an ApiError", async () => {
    server.use(http.post(`${API}/checkout`, () => HttpResponse.json({ error: { code: "OUT_OF_STOCK", message: "Gone.", requestId: "req_9", details: [{ variantId: "v1" }] } }, { status: 409 })));
    const err = await apiFetch("/checkout", { method: "POST", body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ status: 409, code: "OUT_OF_STOCK", message: "Gone.", requestId: "req_9", details: [{ variantId: "v1" }], retryable: false });
  });

  it("reads Retry-After on a rate limit and marks it retryable", async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ error: { code: "RATE_LIMITED", message: "Slow down.", requestId: "r" } }, { status: 429, headers: { "Retry-After": "42" } })));
    const err = (await apiFetch("/auth/login", { method: "POST", body: {} }).catch((e) => e)) as ApiError;
    expect([err.status, err.code, err.retryAfterSeconds, err.retryable]).toEqual([429, "RATE_LIMITED", 42, true]);
  });

  it("does not trust a proxy's HTML error page", async () => {
    server.use(http.get(`${API}/x`, () => new HttpResponse("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway", headers: { "x-request-id": "edge_1" } })));
    const err = (await apiFetch("/x").catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ status: 502, code: "REQUEST_FAILED", requestId: "edge_1", retryable: true });
  });

  it("rejects a success response that is not JSON", async () => {
    server.use(http.get(`${API}/x`, () => new HttpResponse("ok?", { status: 200 })));
    await expect(apiFetch("/x")).rejects.toMatchObject({ code: "REQUEST_FAILED" });
  });

  it("reports a lost connection as a retryable NETWORK_ERROR", async () => {
    server.use(http.get(`${API}/x`, () => HttpResponse.error()));
    const err = (await apiFetch("/x").catch((e) => e)) as ApiError;
    expect([err.status, err.code, err.retryable]).toEqual([0, "NETWORK_ERROR", true]);
  });

  it("lets an abort through untouched so callers can cancel", async () => {
    server.use(http.get(`${API}/slow`, async () => { await delay(200); return HttpResponse.json({}); }));
    const controller = new AbortController();
    const pending = apiFetch("/slow", { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
  });
});

describe("customer authentication", () => {
  it("attaches the bearer token", async () => {
    signIn("tok-abc");
    let auth: string | null = null;
    server.use(http.get(`${API}/me`, ({ request }) => { auth = request.headers.get("authorization"); return HttpResponse.json({ id: "c1" }); }));
    await apiFetch("/me", { auth: "customer" });
    expect(auth).toBe("Bearer tok-abc");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    signIn("expired");
    const seen: (string | null)[] = [];
    let refreshes = 0;
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return request.headers.get("authorization") === "Bearer fresh" ? HttpResponse.json({ id: "c1" }) : unauthorized();
      }),
      http.post(`${API}/auth/refresh`, () => { refreshes++; return HttpResponse.json(session("fresh")); }),
    );
    expect(await apiFetch("/me", { auth: "customer" })).toEqual({ id: "c1" });
    expect(seen).toEqual(["Bearer expired", "Bearer fresh"]);
    expect(refreshes).toBe(1);
    expect(useCustomerSession.getState()).toMatchObject({ status: "authenticated", accessToken: "fresh" });
  });

  it("shares one refresh between simultaneous requests", async () => {
    signIn("expired");
    let refreshes = 0;
    server.use(
      http.get(`${API}/me/:what`, ({ request }) => (request.headers.get("authorization") === "Bearer fresh" ? HttpResponse.json({ ok: true }) : unauthorized())),
      http.post(`${API}/auth/refresh`, async () => { refreshes++; await delay(30); return HttpResponse.json(session("fresh")); }),
    );
    await Promise.all([apiFetch("/me/a", { auth: "customer" }), apiFetch("/me/b", { auth: "customer" }), apiFetch("/me/c", { auth: "customer" })]);
    expect(refreshes).toBe(1);
  });

  it("gives up and signs the customer out when the refresh is rejected", async () => {
    signIn("expired");
    server.use(http.get(`${API}/me`, unauthorized), http.post(`${API}/auth/refresh`, () => HttpResponse.json({ error: { code: "INVALID_REFRESH_TOKEN", message: "Expired.", requestId: "r" } }, { status: 401 })));
    await expect(apiFetch("/me", { auth: "customer" })).rejects.toMatchObject({ status: 401 });
    expect(useCustomerSession.getState()).toMatchObject({ status: "anonymous", accessToken: null, user: null });
  });

  it("does not retry other failures, and does not sign out over a flaky connection", async () => {
    signIn("tok");
    let calls = 0;
    server.use(http.get(`${API}/me`, () => { calls++; return HttpResponse.json({ error: { code: "FORBIDDEN", message: "No.", requestId: "r" } }, { status: 403 }); }));
    await expect(apiFetch("/me", { auth: "customer" })).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(1);

    useCustomerSession.setState({ status: "unknown", accessToken: null });
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()));
    expect(await refreshAccessToken("customer")).toBeNull();
    expect(useCustomerSession.getState().status).toBe("unknown");
  });

  it("does not ask for a refresh from a browser that has never been signed in", async () => {
    const refresh = vi.fn(() => HttpResponse.json(session("never")));
    const quote = vi.fn(() => HttpResponse.json({}));
    server.use(http.post(`${API}/auth/refresh`, refresh), http.post(`${API}/pricing/quote`, quote));
    // Status is still "unknown" (the app has not finished starting) but there is no hint of a past session.
    await expect(apiFetch("/me", { auth: "customer" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await apiFetch("/pricing/quote", { method: "POST", body: {}, auth: "customer", authOptional: true });
    expect(refresh).not.toHaveBeenCalled();
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it("waits for the first refresh when there is no token yet, then uses it", async () => {
    useSessionHints.setState({ customer: true });
    server.use(
      http.post(`${API}/auth/refresh`, async () => { await delay(20); return HttpResponse.json(session("restored")); }),
      http.get(`${API}/me`, ({ request }) => HttpResponse.json({ auth: request.headers.get("authorization") })),
    );
    expect(await apiFetch("/me", { auth: "customer" })).toEqual({ auth: "Bearer restored" });
  });

  it("fails fast as unauthenticated for a signed-out visitor, without calling the server", async () => {
    useCustomerSession.getState().clear();
    const handler = vi.fn(() => HttpResponse.json({}));
    server.use(http.get(`${API}/me`, handler));
    await expect(apiFetch("/me", { auth: "customer" })).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("with optional auth, quotes as a guest when signed out and as the customer when signed in", async () => {
    const headers: (string | null)[] = [];
    server.use(http.post(`${API}/pricing/quote`, ({ request }) => { headers.push(request.headers.get("authorization")); return HttpResponse.json({}); }));
    useCustomerSession.getState().clear();
    await apiFetch("/pricing/quote", { method: "POST", body: {}, auth: "customer", authOptional: true });
    signIn("tok-q");
    await apiFetch("/pricing/quote", { method: "POST", body: {}, auth: "customer", authOptional: true });
    expect(headers).toEqual([null, "Bearer tok-q"]);
  });
});

describe("admin authentication", () => {
  it("is a separate realm: it uses the admin token and the admin refresh endpoint", async () => {
    signIn("customer-token");
    useAdminSession.getState().setSession({ accessToken: "admin-old", expiresIn: 900, user: { id: "a1", email: "a@x.com", roles: ["owner"], permissions: ["*"] } });
    const tokens: (string | null)[] = [];
    server.use(
      http.get(`${API}/admin/orders`, ({ request }) => {
        tokens.push(request.headers.get("authorization"));
        return request.headers.get("authorization") === "Bearer admin-new" ? HttpResponse.json({ data: [] }) : unauthorized();
      }),
      http.post(`${API}/admin/auth/refresh`, () => HttpResponse.json(session("admin-new", "admin"))),
    );
    await apiFetch("/admin/orders", { auth: "admin" });
    expect(tokens).toEqual(["Bearer admin-old", "Bearer admin-new"]);
    expect(useCustomerSession.getState().accessToken).toBe("customer-token");
    expect(useAdminSession.getState().accessToken).toBe("admin-new");
  });
});
