// A small stand-in for the hapi API, so browser tests need no database. It serves a fixed catalogue in the same
// shapes as docs/API.md. Run by Playwright's webServer; start by hand with `node e2e/mock-api.mjs`.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amountMinor) => ({ amountMinor, currency: "NGN" });
const stock = (n) => ({ inStock: n > 0, availableQuantity: n, lowStock: n > 0 && n <= 3 });

const option = (oid, name, values) => ({ id: oid, name, values: values.map(([vid, label, key]) => ({ id: vid, label, valueKey: key, swatch: null })) });
const LENGTH = option("len", "Length", [["l14", "14 inch", "14"], ["l20", "20 inch", "20"]]);
const LACE = option("lace", "Lace", [["hd", "HD lace", "hd-lace"], ["swiss", "Swiss lace", "swiss-lace"]]);

// Bone Straight: 14×HD buyable, 14×Swiss sold out, 20×HD buyable, 20×Swiss never made.
const bone = {
  id: id(1), slug: "bone-straight-frontal", title: "Bone Straight Frontal Wig", description: "Silky bone straight hair on a pre-plucked HD lace frontal.", badge: null, featured: true,
  seo: { title: null, description: null }, details: { details: "**100% human hair**, 180% density.", fit: "Adjustable strap.", care: "Wash gently.", delivery: null },
  defaultVariantId: id(11), soldCount: 40, publishedAt: "2026-01-01T00:00:00Z", categories: [{ slug: "frontal", name: "Frontal" }], collections: [],
  options: [LENGTH, LACE],
  variants: [
    { id: id(11), sku: "BS-14-HD", price: money(18000000), compareAtPrice: money(20000000), optionValueIds: ["l14", "hd"], availability: stock(10) },
    { id: id(12), sku: "BS-14-SW", price: money(17000000), compareAtPrice: null, optionValueIds: ["l14", "swiss"], availability: stock(0) },
    { id: id(13), sku: "BS-20-HD", price: money(24000000), compareAtPrice: null, optionValueIds: ["l20", "hd"], availability: stock(5) },
  ],
  media: [{ id: "m1", variantId: null, objectKey: "k1", url: null, altText: null, mediaType: "image", angle: "front", isCover: true, width: null, height: null }, { id: "m2", variantId: null, objectKey: "k2", url: null, altText: null, mediaType: "image", angle: "side", isCover: false, width: null, height: null }],
  rating: { average: 4.8, count: 3 },
};
const bob = { ...bone, id: id(2), slug: "glueless-bob", title: "Glueless Bob Wig", featured: false, options: [], variants: [{ id: id(21), sku: "GB", price: money(9500000), compareAtPrice: null, optionValueIds: [], availability: stock(8) }], defaultVariantId: id(21), media: [], rating: { average: 0, count: 0 } };
const curly = { ...bob, id: id(3), slug: "deep-curly-closure", title: "Deep Curly Closure Wig", variants: [{ id: id(31), sku: "DC", price: money(12000000), compareAtPrice: null, optionValueIds: [], availability: stock(0) }], defaultVariantId: null };
const PRODUCTS = [bone, bob, curly];

const card = (p) => {
  const prices = p.variants.map((v) => v.price.amountMinor);
  return { id: p.id, slug: p.slug, title: p.title, badge: p.badge, badges: p.variants.some((v) => v.compareAtPrice) ? [{ kind: "sale", label: "-10%" }] : [], colours: [], lengthRange: null, featured: p.featured,
    price: { minAmountMinor: Math.min(...prices), maxAmountMinor: Math.max(...prices), currency: "NGN" }, inStock: p.variants.some((v) => v.availability.inStock), onOffer: p.variants.some((v) => v.compareAtPrice), rating: p.rating, image: null };
};

const facets = {
  options: { texture: [{ valueKey: "straight", label: "Straight", swatch: null, count: 2 }], lace: [{ valueKey: "hd-lace", label: "HD lace", swatch: null, count: 1 }], length: [{ valueKey: "14", label: "14", swatch: null, count: 2 }, { valueKey: "20", label: "20", swatch: null, count: 1 }], density: [], colour: [] },
  price: { minMinor: 9500000, maxMinor: 24000000 }, inStockCount: 2, onOfferCount: 1,
};

const home = {
  announcements: [{ id: "a1", text: "Free same-day delivery in Lagos over ₦150,000" }],
  sections: [
    { type: "hero", cards: [{ id: "h1", tag: "New in", headline: "Wigs you will love", subheadline: "Delivered fast.", tone: "pink", ctaLabel: "Shop now", ctaUrl: "/shop", endsAt: null }] },
    { type: "products", title: "Jetty's picks", tabs: [{ key: "featured", label: "Featured", products: PRODUCTS.map(card) }, { key: "deal", label: "On deal", products: [card(bone)] }] },
    { type: "length", title: "Shop by length", items: [{ label: "14–16", hint: "Shoulder", lengths: [14, 16] }, { label: "20–22", hint: "Bra strap", lengths: [20, 22] }] },
    { type: "trust", items: [{ icon: "lock", title: "Secure pay", caption: "Card or transfer" }, { icon: "return", title: "7-day returns", caption: "No stress" }] },
  ],
};
const settings = { store: { name: "Jetty's Hair", contactEmail: "hello@example.com", contactPhone: "+2348000000000", whatsappNumber: "+2348000000000", showroomAddress: "Lekki, Lagos", showroomHours: "Mon–Sat 10–6" }, policies: { returnWindowDays: 7, podMaxOrderMinor: null }, payments: { enabledMethods: ["card", "bank_transfer"], cardHoldMinutes: 30, transferHoldMinutes: 120 } };

function listing(url, onlyOffer) {
  const q = url.searchParams.get("q")?.toLowerCase();
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const start = Number(url.searchParams.get("cursor") ?? 0);
  let items = PRODUCTS.map(card);
  if (q) items = items.filter((p) => p.title.toLowerCase().includes(q));
  if (url.searchParams.get("inStock") === "true") items = items.filter((p) => p.inStock);
  if (url.searchParams.get("onOffer") === "true" || onlyOffer) items = items.filter((p) => p.onOffer);
  const sort = url.searchParams.get("sort");
  if (sort === "priceAsc") items.sort((a, b) => a.price.minAmountMinor - b.price.minAmountMinor);
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : null;
  return { data: page, page: { nextCursor: next, ...(start === 0 ? { total: items.length } : {}) } };
}

function quote(items, codes = []) {
  const lines = items.flatMap((i) => {
    const v = PRODUCTS.flatMap((p) => p.variants.map((x) => ({ p, x }))).find((r) => r.x.id === i.variantId);
    if (!v) return [];
    return [{ variantId: v.x.id, productId: v.p.id, slug: v.p.slug, title: v.p.title, image: null, options: [], optionSummary: "", compareAtPriceMinor: v.x.compareAtPrice?.amountMinor ?? null, availableQuantity: v.x.availability.availableQuantity, quantity: i.quantity, unitPriceMinor: v.x.price.amountMinor, lineSubtotalMinor: v.x.price.amountMinor * i.quantity, discountMinor: 0, lineTotalMinor: v.x.price.amountMinor * i.quantity, promotionAllocations: [] }];
  });
  const subtotal = lines.reduce((n, l) => n + l.lineTotalMinor, 0);
  const applied = codes.filter((c) => c === "SAVE10").map(() => ({ promotionId: "promo", name: "10% off", kind: "percentage", code: "SAVE10", discountMinor: Math.round(subtotal / 10) }));
  const discount = applied.reduce((n, p) => n + p.discountMinor, 0);
  const rejectedCodes = codes.filter((c) => c !== "SAVE10").map((code) => ({ code, reason: "INVALID_CODE" }));
  return { currency: "NGN", lines, promotions: { applied, rejectedCodes }, warnings: [], subtotalMinor: subtotal, discountMinor: discount, delivery: null, deliveryFeeMinor: 0, taxMinor: 0, totalMinor: subtotal - discount, quoteId: "q", quoteExpiresAt: "2099-01-01T00:00:00Z" };
}

// Accounts: reset code 123456 and password "correct-horse-1" are accepted; taken@example.com already has an account.
const customer = (email) => ({ id: id(500), phone: null, email, emailVerified: false, phoneVerified: false, createdAt: "2026-01-01T00:00:00Z" });
const session = (email) => ({ accessToken: "tok", tokenType: "Bearer", expiresIn: 900, customer: customer(email) });
const SEEDED = {
  id: id(700), orderNumber: "JH-20001", status: "delivered", paymentStatus: "paid", currency: "NGN", totalMinor: 18300000, itemCount: 1, placedAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z",
  contact: { phone: "+2348031234567", email: null }, deliveryMethod: "same_day", deliveryAddress: { recipientName: "Ada Obi", addressLine1: "12 Admiralty Way", city: "Lekki", state: "Lagos" }, estimate: null, rider: null,
  items: [{ id: id(701), slug: "bone-straight-frontal", image: null, reviewable: true, productId: id(1), variantId: id(11), sku: "BS-14-HD", title: "Bone Straight Frontal Wig", options: { Length: "14 inch" }, quantity: 1, unitPriceMinor: 18000000, discountMinor: 0, lineTotalMinor: 18000000 }],
  totals: { subtotalMinor: 18000000, discountMinor: 0, deliveryFeeMinor: 300000, taxMinor: 0, totalMinor: 18300000 }, promotions: [], reservationExpiresAt: null,
  timeline: [{ status: "placed", at: "2026-09-01T10:00:00Z" }, { status: "delivered", at: "2026-09-02T10:00:00Z" }],
};
const hasCookie = (req) => (req.headers.cookie ?? "").includes("jh_refresh=");
const needsAuth = (req) => (req.headers.authorization ?? "").startsWith("Bearer ");

// Admin: password "correct-horse-1"; the email's prefix picks the role. Each sign-in is a session that tests can revoke.
const ADMIN_ROLES = {
  owner: ["*"],
  support: ["orders:read", "customers:read", "reviews:moderate"],
  editor: ["content:write", "catalog:read"],
};
const adminSessions = new Map();
let adminCounter = 0;
const adminCookie = (req) => /jh_admin_refresh=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
const adminIdentity = (s) => ({ id: id(600), email: s.email, roles: [s.role], permissions: ADMIN_ROLES[s.role] });
const adminSession = (sid) => { const s = adminSessions.get(sid); return { accessToken: `adm.${sid}`, tokenType: "Bearer", expiresIn: 900, admin: adminIdentity(s) }; };
/** The admin session behind a request's bearer token, or null if it is missing or revoked. */
const adminFrom = (req) => {
  const sid = /^Bearer adm\.(.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const s = sid && adminSessions.get(sid);
  return s && !s.revoked ? s : null;
};
const can = (s, perm) => ADMIN_ROLES[s.role].includes("*") || ADMIN_ROLES[s.role].includes(perm);

// Orders placed during a test run, keyed by id. A recipient named "Fail Test" gets a payment that has already failed.
const orders = new Map();
let counter = 0;
const orderStatus = (o) => ({
  orderId: o.id, orderNumber: o.number, status: o.paid ? "placed" : "pending_payment", paymentStatus: o.paid ? "paid" : "pending", amountMinor: o.amount, currency: "NGN",
  reservationExpiresAt: "2099-01-01T00:00:00Z", deliveryMethod: o.deliveryMethod, estimate: { earliestDate: "2026-10-21", latestDate: "2026-10-21" }, itemCount: o.items,
  recipientFirstName: o.firstName, paymentAttempt: { id: "a" + o.attempt, status: o.paid ? "succeeded" : o.failed ? "failed" : "pending" },
});
const paymentStart = (o) => ({ orderId: o.id, orderNumber: o.number, paymentAttemptId: "a" + o.attempt, provider: "paystack", reference: `ref-${o.id}-${o.attempt}`, accessCode: "code" + o.attempt, authorizationUrl: "https://checkout.paystack.com/x", amountMinor: o.amount, currency: "NGN", reservationExpiresAt: "2099-01-01T00:00:00Z" });

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,idempotency-key,if-match,x-request-id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/api\/v1/, "");
  let body = "";
  for await (const chunk of req) body += chunk;
  const send = (status, data) => void res.writeHead(status, { "content-type": "application/json" }).end(data === undefined ? undefined : JSON.stringify(data));

  if (req.method === "GET") {
    if (path.startsWith("/admin/")) {
      const a = adminFrom(req);
      if (!a) return send(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required.", requestId: "r" } });
      if (path === "/admin/me") return send(200, adminIdentity(a));
      if (path === "/admin/orders-to-action") return can(a, "orders:read") ? send(200, { toPack: 3, toDispatch: 2, outForDelivery: 1, awaitingTransfer: 1, paymentExceptions: 0 }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      if (path === "/admin/reviews") return can(a, "reviews:moderate") ? send(200, { data: [], page: { total: 4, nextCursor: null } }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
    }
    if (path === "/me/orders") return needsAuth(req) ? send(200, { data: [{ id: SEEDED.id, orderNumber: SEEDED.orderNumber, status: SEEDED.status, paymentStatus: "paid", currency: "NGN", totalMinor: SEEDED.totalMinor, itemCount: 1, placedAt: SEEDED.placedAt, createdAt: SEEDED.createdAt }], page: { nextCursor: null } }) : send(401, { error: { code: "UNAUTHENTICATED", message: "Sign in", requestId: "r" } });
    if (path === `/me/orders/${SEEDED.id}`) return needsAuth(req) ? send(200, SEEDED) : send(401, { error: { code: "UNAUTHENTICATED", message: "Sign in", requestId: "r" } });
    if (path === "/health") return send(200, { ok: true });
    if (path === "/storefront/home") return send(200, { data: home });
    if (path === "/storefront/settings") return send(200, { data: settings });
    const pageMatch = path.match(/^\/content\/pages\/([^/]+)$/);
    if (pageMatch) {
      const pages = { returns: { title: "Returns and refunds", markdown: "## Returning an item\n\nYou can return an item within **7 days** of delivery.\n\n[Track an order](/track) or read the [FAQs](https://example.com/faqs).\n\n<script>alert(1)</script>" }, contact: { title: "Contact us", markdown: "We are happy to help." } };
      const found = pages[pageMatch[1]];
      return found ? send(200, { data: { slug: pageMatch[1], ...found, updatedAt: "2026-10-01T00:00:00Z" } }) : send(404, { error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } });
    }
    if (path === "/categories") return send(200, { data: { categories: [{ id: "c1", slug: "frontal", name: "Frontal wigs", children: [] }], collections: [{ id: "k1", slug: "new-arrivals", name: "New arrivals", description: null }] } });
    if (path === "/products") return send(200, listing(url));
    if (path === "/products/facets") return send(200, { data: facets });
    if (path === "/products/suggestions") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return send(200, { data: PRODUCTS.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({ id: p.id, slug: p.slug, title: p.title, image: null })) });
    }
    const status = path.match(/^\/checkout\/([^/]+)\/status$/);
    if (status) return orders.has(status[1]) ? send(200, orderStatus(orders.get(status[1]))) : send(404, { error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } });
    const reviews = path.match(/^\/products\/([^/]+)\/reviews$/);
    if (reviews) return send(200, { summary: { average: 4.8, count: 3, breakdown: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 } }, data: [{ id: "r1", rating: 5, title: "Love it", body: "Lies flat.", location: "Lagos", verifiedBuyer: true, variant: null, createdAt: "2026-02-01T00:00:00Z" }], page: { nextCursor: null } });
    const collection = path.match(/^\/collections\/([^/]+)\/products$/);
    if (collection) return send(200, listing(url));
    const product = path.match(/^\/products\/([^/]+)$/);
    if (product) {
      const found = PRODUCTS.find((p) => p.slug === product[1]);
      return found ? send(200, { data: found }) : send(404, { error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } });
    }
  }
  if (req.method === "POST") {
    const json = body ? JSON.parse(body) : {};
    const bad = (status, code) => send(status, { error: { code, message: code, requestId: "r" } });
    const login = (email) => {
      res.setHeader("Set-Cookie", "jh_refresh=1; Path=/; HttpOnly; SameSite=Lax");
      return send(200, session(email));
    };
    if (path === "/auth/register") return json.email === "taken@example.com" ? bad(409, "ACCOUNT_EXISTS") : login(json.email);
    if (path === "/auth/login") return json.password === "correct-horse-1" ? login(json.email) : bad(401, "INVALID_CREDENTIALS");
    if (path === "/auth/password/forgot") return send(202, { expiresInSeconds: 600, resendAfterSeconds: 60 });
    if (path === "/auth/password/reset") return json.code === "123456" ? send(204) : bad(401, "INVALID_CODE");
    if (path === "/auth/refresh") return hasCookie(req) ? send(200, session("ada@example.com")) : bad(401, "INVALID_REFRESH_TOKEN");
    if (path === "/auth/logout") {
      res.setHeader("Set-Cookie", "jh_refresh=; Path=/; HttpOnly; Max-Age=0");
      return send(204);
    }
    if (path === "/reviews") return send(201, { id: "rev1", status: "pending" });
    if (path === "/admin/auth/login") {
      const role = Object.keys(ADMIN_ROLES).find((r) => String(json.email).startsWith(`${r}@`));
      if (!role || json.password !== "correct-horse-1") return bad(401, "INVALID_CREDENTIALS");
      const sid = `s${++adminCounter}`;
      adminSessions.set(sid, { role, email: json.email, revoked: false });
      res.setHeader("Set-Cookie", `jh_admin_refresh=${sid}; Path=/; HttpOnly; SameSite=Lax`);
      return send(200, adminSession(sid));
    }
    if (path === "/admin/auth/refresh") {
      const sid = adminCookie(req);
      const s = sid && adminSessions.get(sid);
      return s && !s.revoked ? send(200, adminSession(sid)) : bad(401, "INVALID_REFRESH_TOKEN");
    }
    if (path === "/admin/auth/logout") {
      const sid = adminCookie(req);
      if (sid && adminSessions.has(sid)) adminSessions.get(sid).revoked = true;
      res.setHeader("Set-Cookie", "jh_admin_refresh=; Path=/; HttpOnly; Max-Age=0");
      return send(204);
    }
    const revoke = path.match(/^\/__test\/revoke-admin\/(.+)$/);
    if (revoke) {
      if (adminSessions.has(revoke[1])) adminSessions.get(revoke[1]).revoked = true;
      return send(204);
    }
    if (path === "/pricing/quote") return send(200, quote(json.items ?? [], json.promotionCodes ?? []));
    if (path === "/delivery/quotes") {
      return send(200, { currency: "NGN", zone: { id: "z", name: "Lagos", state: json.deliveryAddress?.state ?? "Lagos" }, warnings: [], options: [{ method: "same_day", available: true, baseFeeMinor: 300000, feeMinor: 300000, freeDeliveryPromotionId: null, estimate: { earliestDate: "2026-10-21", latestDate: "2026-10-21" } }] });
    }
    if (path === "/checkout") {
      const q = quote(json.items ?? [], json.promotionCodes ?? []);
      const n = ++counter;
      const o = { id: id(900 + n), number: `JH-${10000 + n}`, amount: q.totalMinor + 300000, paid: false, failed: json.deliveryAddress?.recipientName === "Fail Test", attempt: 1, items: (json.items ?? []).length, deliveryMethod: json.deliveryMethod, firstName: String(json.deliveryAddress?.recipientName ?? "").split(" ")[0], phone: json.contact?.phone };
      orders.set(o.id, o);
      return send(201, { ...paymentStart(o), quote: q });
    }
    if (path === "/checkout/paystack/verify") {
      const o = [...orders.values()].find((x) => json.reference === `ref-${x.id}-${x.attempt}`);
      if (!o) return send(404, { error: { code: "NOT_FOUND", message: "Unknown reference", requestId: "r" } });
      o.paid = true;
      return send(200, orderStatus(o));
    }
    const retry = path.match(/^\/checkout\/([^/]+)\/payment-attempts$/);
    if (retry && orders.has(retry[1])) {
      const o = orders.get(retry[1]);
      o.attempt += 1;
      o.failed = false;
      return send(201, paymentStart(o));
    }
    if (path === "/orders/track") {
      const o = [...orders.values()].find((x) => x.number === json.orderNumber && x.phone === json.phone);
      return o ? send(200, { orderNumber: o.number, status: o.paid ? "placed" : "pending_payment", paymentStatus: o.paid ? "paid" : "pending", deliveryMethod: o.deliveryMethod, placedAt: "2026-10-20T10:00:00Z", timeline: [] }) : send(404, { error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } });
    }
    return send(204);
  }
  return send(404, { error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } });
});

server.listen(PORT, () => console.log(`mock API on :${PORT}`));
