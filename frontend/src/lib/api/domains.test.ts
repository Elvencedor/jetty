import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { API, server } from "@/test/server";
import { useCustomerSession } from "@/lib/stores/session";
import { forgotPassword, getMyOrder, register, requestLoginCode, signIn, signOut, submitReview, verifyLoginCode } from "./account";
import { getCategories, getFacets, getProduct, getProducts, getReviews, getSuggestions } from "./catalog";
import { getCheckoutStatus, placeOrder, retryPayment, trackOrder, verifyPayment } from "./checkout";
import { getHome, getPage, getStoreSettings } from "./content";
import { getDeliveryQuote, getQuote } from "./pricing";
import type { CheckoutRequest } from "./types";

const customer = { id: "c1", phone: "+2348031234567", email: null, emailVerified: false, phoneVerified: true, createdAt: "2026-01-01T00:00:00Z" };
const sessionBody = { accessToken: "tok-new", tokenType: "Bearer", expiresIn: 900, customer };
const capture = () => {
  const seen: { url: URL; method: string; headers: Headers; body: unknown }[] = [];
  const record = async ({ request }: { request: Request }) => {
    seen.push({ url: new URL(request.url), method: request.method, headers: request.headers, body: request.method === "GET" ? null : await request.clone().json().catch(() => null) });
  };
  return { seen, record };
};
const VARIANT = "11111111-1111-4111-8111-111111111111";

describe("catalog", () => {
  it("sends listing filters as query parameters and returns the page envelope", async () => {
    const { seen, record } = capture();
    server.use(http.get(`${API}/products`, async (ctx) => { await record(ctx); return HttpResponse.json({ data: [], page: { nextCursor: null, total: 0 } }); }));
    const result = await getProducts({ q: "bob", sort: "priceAsc", length: ["14", "20"], inStock: true, minPrice: 5_000_000 });
    expect(result.page.total).toBe(0);
    const params = seen[0]!.url.searchParams;
    expect([params.get("q"), params.get("sort"), params.getAll("length"), params.get("inStock"), params.get("minPrice")]).toEqual(["bob", "priceAsc", ["14", "20"], "true", "5000000"]);
  });

  it("unwraps { data } for details, categories, facets and suggestions", async () => {
    server.use(
      http.get(`${API}/products/body-wave`, () => HttpResponse.json({ data: { slug: "body-wave" } })),
      http.get(`${API}/categories`, () => HttpResponse.json({ data: { categories: [], collections: [] } })),
      http.get(`${API}/products/facets`, () => HttpResponse.json({ data: { inStockCount: 3 } })),
      http.get(`${API}/products/suggestions`, ({ request }) => HttpResponse.json({ data: [{ title: new URL(request.url).searchParams.get("q") }] })),
    );
    expect(await getProduct("body-wave")).toMatchObject({ slug: "body-wave" });
    expect(await getCategories()).toEqual({ categories: [], collections: [] });
    expect(await getFacets({ colour: ["black"] })).toMatchObject({ inStockCount: 3 });
    expect(await getSuggestions("fro")).toEqual([{ title: "fro" }]);
  });

  it("encodes slugs and ids that go in the path", async () => {
    const { seen, record } = capture();
    server.use(http.get(`${API}/products/:slug`, async (ctx) => { await record(ctx); return HttpResponse.json({ data: {} }); }), http.get(`${API}/products/:id/reviews`, async (ctx) => { await record(ctx); return HttpResponse.json({ data: [] }); }));
    await getProduct("a/b c");
    await getReviews("p 1", { sort: "highest", rating: 5 });
    expect(seen[0]!.url.pathname).toBe("/api/v1/products/a%2Fb%20c");
    expect(seen[1]!.url.pathname).toBe("/api/v1/products/p%201/reviews");
    expect(seen[1]!.url.searchParams.get("rating")).toBe("5");
  });
});

describe("content", () => {
  it("unwraps home, settings and pages", async () => {
    server.use(
      http.get(`${API}/storefront/home`, () => HttpResponse.json({ data: { announcements: [], sections: [] } })),
      http.get(`${API}/storefront/settings`, () => HttpResponse.json({ data: { store: { name: "Jetty's Hair" } } })),
      http.get(`${API}/content/pages/returns`, () => HttpResponse.json({ data: { title: "Returns" } })),
    );
    expect(await getHome()).toEqual({ announcements: [], sections: [] });
    expect((await getStoreSettings()).store.name).toBe("Jetty's Hair");
    expect(await getPage("returns")).toMatchObject({ title: "Returns" });
  });
});

describe("pricing and checkout", () => {
  it("quotes as a guest, and with the customer's token when signed in", async () => {
    const { seen, record } = capture();
    server.use(http.post(`${API}/pricing/quote`, async (ctx) => { await record(ctx); return HttpResponse.json({ totalMinor: 1 }); }), http.post(`${API}/delivery/quotes`, async (ctx) => { await record(ctx); return HttpResponse.json({ options: [] }); }));
    useCustomerSession.getState().clear();
    await getQuote({ items: [{ variantId: VARIANT, quantity: 1 }], promotionCodes: [] });
    useCustomerSession.getState().setSession({ accessToken: "tok-q", expiresIn: 900, user: customer });
    await getQuote({ items: [{ variantId: VARIANT, quantity: 1 }], promotionCodes: ["SAVE"] });
    await getDeliveryQuote({ items: [{ variantId: VARIANT, quantity: 1 }], promotionCodes: [], deliveryAddress: { state: "Lagos" } });
    expect(seen.map((s) => s.headers.get("authorization"))).toEqual([null, "Bearer tok-q", "Bearer tok-q"]);
    expect(seen[1]!.body).toMatchObject({ promotionCodes: ["SAVE"] });
  });

  it("places an order with the idempotency key, attached to the customer when signed in", async () => {
    const { seen, record } = capture();
    server.use(http.post(`${API}/checkout`, async (ctx) => { await record(ctx); return HttpResponse.json({ orderId: "o1" }, { status: 201 }); }));
    const body: CheckoutRequest = {
      items: [{ variantId: VARIANT, quantity: 1 }],
      promotionCodes: [],
      contact: { phone: "+2348031234567" },
      deliveryAddress: { recipientName: "Ada", addressLine1: "1 St", city: "Lagos", state: "Lagos", countryCode: "NG" },
      deliveryMethod: "next_day",
      paymentMethod: "card",
      termsAccepted: true,
    };
    await placeOrder(body, "0123456789abcdef0123456789abcdef");
    useCustomerSession.getState().setSession({ accessToken: "tok-c", expiresIn: 900, user: customer });
    await placeOrder(body, "0123456789abcdef0123456789abcdef");
    expect(seen.map((s) => [s.headers.get("idempotency-key"), s.headers.get("authorization")])).toEqual([
      ["0123456789abcdef0123456789abcdef", null],
      ["0123456789abcdef0123456789abcdef", "Bearer tok-c"],
    ]);
  });

  it("retries payment, verifies by reference, polls status and tracks guests", async () => {
    const { seen, record } = capture();
    server.use(
      http.post(`${API}/checkout/o1/payment-attempts`, async (ctx) => { await record(ctx); return HttpResponse.json({ reference: "r2" }, { status: 201 }); }),
      http.post(`${API}/checkout/paystack/verify`, async (ctx) => { await record(ctx); return HttpResponse.json({ status: "placed" }); }),
      http.get(`${API}/checkout/o1/status`, async (ctx) => { await record(ctx); return HttpResponse.json({ status: "pending_payment" }); }),
      http.post(`${API}/orders/track`, async (ctx) => { await record(ctx); return HttpResponse.json({ timeline: [] }); }),
    );
    await retryPayment("o1", "k".repeat(32));
    await verifyPayment("ref_123");
    await getCheckoutStatus("o1");
    await trackOrder({ orderNumber: "JH-20261020-0001", phone: "+2348031234567" });
    expect(seen[0]!.headers.get("idempotency-key")).toBe("k".repeat(32));
    expect(seen[1]!.body).toEqual({ reference: "ref_123" });
    expect(seen[3]!.body).toEqual({ orderNumber: "JH-20261020-0001", phone: "+2348031234567" });
  });
});

describe("account", () => {
  it("signs in with a password, with a code, and registers; each starts the session", async () => {
    server.use(
      http.post(`${API}/auth/login`, () => HttpResponse.json({ ...sessionBody, accessToken: "from-login" })),
      http.post(`${API}/auth/otp/verify`, () => HttpResponse.json({ ...sessionBody, accessToken: "from-otp" })),
      http.post(`${API}/auth/register`, () => HttpResponse.json({ ...sessionBody, accessToken: "from-register" }, { status: 201 })),
    );
    expect(await signIn({ phone: "+2348031234567", password: "pw" })).toEqual(customer);
    expect(useCustomerSession.getState()).toMatchObject({ status: "authenticated", accessToken: "from-login", user: customer });
    await verifyLoginCode({ phone: "+2348031234567", code: "123456" });
    expect(useCustomerSession.getState().accessToken).toBe("from-otp");
    await register({ phone: "+2348031234567", password: "correct horse battery" });
    expect(useCustomerSession.getState().accessToken).toBe("from-register");
    expect(useCustomerSession.getState().expiresAt).toBeGreaterThan(Date.now());
  });

  it("does not start a session when sign-in fails", async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "Wrong.", requestId: "r" } }, { status: 401 })));
    await expect(signIn({ phone: "+2348031234567", password: "bad" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(useCustomerSession.getState().status).toBe("unknown");
  });

  it("requests codes and resets passwords without starting a session", async () => {
    server.use(
      http.post(`${API}/auth/otp/request`, () => HttpResponse.json({ expiresInSeconds: 600, resendAfterSeconds: 60 }, { status: 202 })),
      http.post(`${API}/auth/password/forgot`, () => HttpResponse.json({ expiresInSeconds: 600, resendAfterSeconds: 60 }, { status: 202 })),
    );
    expect(await requestLoginCode("+2348031234567")).toMatchObject({ resendAfterSeconds: 60 });
    expect(await forgotPassword({ email: "a@x.com" })).toMatchObject({ expiresInSeconds: 600 });
    expect(useCustomerSession.getState().status).toBe("unknown");
  });

  it("signs out of this browser even if the server cannot be reached", async () => {
    useCustomerSession.getState().setSession({ accessToken: "tok", expiresIn: 900, user: customer });
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    await expect(signOut()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(useCustomerSession.getState()).toMatchObject({ status: "anonymous", accessToken: null, user: null });
  });

  it("reads orders and submits reviews as the customer", async () => {
    const { seen, record } = capture();
    useCustomerSession.getState().setSession({ accessToken: "tok-o", expiresIn: 900, user: customer });
    server.use(
      http.get(`${API}/me/orders/o1`, async (ctx) => { await record(ctx); return HttpResponse.json({ id: "o1" }); }),
      http.post(`${API}/reviews`, async (ctx) => { await record(ctx); return HttpResponse.json({ id: "rv1", status: "pending" }, { status: 201 }); }),
    );
    expect(await getMyOrder("o1")).toEqual({ id: "o1" });
    expect(await submitReview({ orderItemId: "i1", rating: 5, title: "Love it" })).toEqual({ id: "rv1", status: "pending" });
    expect(seen.map((s) => s.headers.get("authorization"))).toEqual(["Bearer tok-o", "Bearer tok-o"]);
  });
});
