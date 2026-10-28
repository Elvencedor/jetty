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
  // A code that adds a free gift: the first product in the catalogue that is not already the bag's, priced but free.
  if (codes.includes("GIFTME") && lines.length) {
    const g = PRODUCTS.flatMap((p) => p.variants.map((x) => ({ p, x }))).find((r) => !lines.some((l) => l.variantId === r.x.id));
    if (g) lines.push({ variantId: g.x.id, productId: g.p.id, slug: g.p.slug, title: g.p.title, image: null, options: [], optionSummary: "", compareAtPriceMinor: null, availableQuantity: 9, quantity: 1, unitPriceMinor: g.x.price.amountMinor, lineSubtotalMinor: g.x.price.amountMinor, discountMinor: g.x.price.amountMinor, lineTotalMinor: 0, promotionAllocations: [{ promotionId: "gift", amountMinor: g.x.price.amountMinor }], gift: { promotionId: "gift" } });
  }
  const giftValue = lines.filter((l) => l.gift).reduce((n, l) => n + l.lineSubtotalMinor, 0);
  const paidSubtotal = lines.filter((l) => !l.gift).reduce((n, l) => n + l.lineTotalMinor, 0);
  const subtotal = paidSubtotal + giftValue;
  const applied = codes.filter((c) => c === "GIFTME").map(() => ({ promotionId: "gift", name: "Free gift", kind: "free_gift", code: "GIFTME", discountMinor: giftValue })).concat(codes.filter((c) => c === "SAVE10").map(() => ({ promotionId: "promo", name: "10% off", kind: "percentage", code: "SAVE10", discountMinor: Math.round(paidSubtotal / 10) })));
  const discount = applied.reduce((n, p) => n + p.discountMinor, 0);
  const rejectedCodes = codes.filter((c) => c !== "SAVE10" && c !== "GIFTME").map((code) => ({ code, reason: "INVALID_CODE" }));
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
  manager: ["settings:read", "orders:read"],
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

// Admin catalogue: one editable product kept in memory. Its ETag is its version; `If-Match` must match it.
const V = (n) => id(2000 + n);
const adminProducts = new Map();
function seedAdminProducts() {
  adminProducts.clear();
  const mk = (idn, title, slug, status, featured, variants, options) => adminProducts.set(V(idn), { id: V(idn), title, slug, status, featured, description: "Soft and full.", version: 1_700_000_000_000 + idn, categoryIds: [], media: [], options, variants });
  const o = (name, values) => ({ id: `opt-${name}`, name, values: values.map(([label, key, delta, swatch]) => ({ id: `val-${key}`, label, valueKey: key, priceDeltaMinor: delta, swatch: swatch ?? null, active: true })) });
  const opts = () => [o("Length", [['12"', "12", 0], ['14"', "14", 1000000]]), o("Lace", [["4×4 closure", "4x4-closure", -2000000], ["13×4 HD", "13x4-hd", 0]]), o("Colour", [["Natural 1B", "natural-1b", 0, "#1e1612"]])];
  const base = 14500000;
  const rows = [["12", "4x4-closure", base - 2000000, 3], ["12", "13x4-hd", base, 0], ["14", "4x4-closure", base - 1000000, 8], ["14", "13x4-hd", base + 1000000, 1]];
  mk(1, "Bone Straight HD Frontal", "bone-straight-hd-frontal", "active", true, rows.map(([l, c, p, n], i) => ({ id: V(100 + i), sku: `BS-${l}-${c.toUpperCase()}`, optionValues: { Length: l, Lace: c, Colour: "natural-1b" }, priceMinor: p, compareAtPriceMinor: null, active: true, stock: { onHand: n, reserved: 0, lowStockThreshold: null } })), opts());
  mk(2, "Silk Sleep Bonnet", "silk-sleep-bonnet", "draft", false, [{ id: V(200), sku: "BONNET-1", optionValues: {}, priceMinor: 1200000, compareAtPriceMinor: null, active: true, stock: { onHand: 40, reserved: 0, lowStockThreshold: null } }], []);
}
seedAdminProducts();
const etagOfProduct = (p) => `"${p.version}"`;
const productDetail = (p) => ({
  product: { id: p.id, slug: p.slug, title: p.title, description: p.description, status: p.status, featured: p.featured, badgeOverride: null, tags: p.tags ?? [], seoTitle: null, seoDescription: null, details: null, categoryIds: p.categoryIds, collectionIds: [], updatedAt: new Date(p.version).toISOString() },
  options: p.options, media: p.media,
  variants: p.variants.map((v) => ({ ...v, stock: { ...v.stock, available: Math.max(v.stock.onHand - v.stock.reserved, 0) } })),
});
const productRow = (p) => {
  const act = p.variants.filter((v) => v.active);
  const prices = act.map((v) => v.priceMinor);
  return { id: p.id, slug: p.slug, title: p.title, status: p.status, featured: p.featured, publishedAt: null, updatedAt: new Date(p.version).toISOString(), variantCount: act.length, availableQuantity: act.reduce((n, v) => n + Math.max(v.stock.onHand - v.stock.reserved, 0), 0), lowStock: act.some((v) => v.stock.onHand <= 1), minPriceMinor: prices.length ? Math.min(...prices) : null, maxPriceMinor: prices.length ? Math.max(...prices) : null, coverUrl: null };
};

// ---- admin orders: a small book of orders in different states, reset with the products
const O = (n) => id(3000 + n);
const adminOrders = new Map();
const EVENT_TIMES = ["2026-10-20T09:00:00Z", "2026-10-20T09:05:00Z", "2026-10-20T10:00:00Z"];
function seedAdminOrders() {
  adminOrders.clear();
  const mk = (n, o) => adminOrders.set(O(n), {
    id: O(n), number: `JH-${10480 + n}`, status: "placed", paymentStatus: "paid", method: "card", deliveryMethod: "delivery", recipient: "Adaeze Okafor", phone: "+2348030000000", email: "adaeze@example.com",
    area: "Lekki", state: "Lagos", subtotal: 20_000_000, discount: 0, fee: 0, createdAt: "2026-10-20T09:00:00Z", rider: null, riderPhone: null, notes: [], refunds: [], promos: [],
    items: [{ title: "Bone Straight HD Frontal", options: { Length: '12"', Lace: "13×4 HD" }, sku: "BS-12-13", qty: 1, unit: 20_000_000 }],
    timeline: [], ...o,
  });
  mk(1, { status: "placed", timeline: [[null, "pending_payment"], ["pending_payment", "placed"]], items: [{ title: "Bone Straight HD Frontal", options: { Length: '12"', Lace: "13×4 HD" }, sku: "BS-12-13", qty: 1, unit: 20_000_000 }, { title: "Silk Sleep Bonnet", options: {}, sku: "SB-CH", qty: 2, unit: 500_000 }], subtotal: 21_000_000, discount: 1_000_000, promos: [{ code: "FLASH15" }] });
  mk(2, { status: "pending_payment", paymentStatus: "pending", method: "bank_transfer", recipient: "Tolu Bello", phone: "+2348031111111", email: null, area: "Yaba", createdAt: "2026-10-20T10:15:00Z", timeline: [[null, "pending_payment"]] });
  mk(3, { status: "out_for_delivery", recipient: "Ngozi Eze", phone: "+2348032222222", area: "Ikeja", rider: "Musa", riderPhone: "+2348099999999", timeline: [[null, "pending_payment"], ["pending_payment", "placed"], ["placed", "packed"], ["packed", "out_for_delivery"]] });
  mk(4, { status: "delivered", deliveryMethod: "pickup", recipient: "Chioma Nwosu", phone: "+2348033333333", area: null, state: null, timeline: [[null, "pending_payment"], ["pending_payment", "placed"], ["placed", "packed"], ["packed", "delivered"]] });
  mk(5, { status: "packed", recipient: "Amaka Obi", phone: "+2348034444444", area: "Victoria Island", timeline: [[null, "pending_payment"], ["pending_payment", "placed"], ["placed", "packed"]] });
}
const orderTotal = (o) => o.subtotal - o.discount + o.fee;
const orderRow = (o) => ({
  id: o.id, orderNumber: o.number, status: o.status, paymentStatus: o.paymentStatus, totalMinor: orderTotal(o), currency: "NGN", deliveryMethod: o.deliveryMethod, phone: o.phone, email: o.email, recipientName: o.recipient,
  area: o.area, state: o.state, hasAccount: false, itemCount: o.items.reduce((n, i) => n + i.qty, 0), items: o.items.map((i) => ({ title: i.title, quantity: i.qty, image: null })), placedAt: o.paymentStatus === "paid" ? o.createdAt : null, createdAt: o.createdAt,
});
const allowedFor = (o) => (o.paymentStatus !== "paid" ? [] : o.status === "placed" ? ["packed"] : o.status === "packed" ? [o.deliveryMethod === "pickup" ? "delivered" : "out_for_delivery"] : o.status === "out_for_delivery" ? ["delivered"] : []);
const orderDetail = (o) => ({
  order: { id: o.id, orderNumber: o.number, status: o.status, paymentStatus: o.paymentStatus, email: o.email, phoneE164: o.phone, currency: "NGN", subtotalMinor: o.subtotal, discountMinor: o.discount, deliveryFeeMinor: o.fee, taxMinor: 0, totalMinor: orderTotal(o), deliveryMethod: o.deliveryMethod,
    deliveryAddressSnapshot: { recipientName: o.recipient, line1: "14 Admiralty Way", area: o.area, city: o.state ?? "Lagos", state: o.state ?? "Lagos" }, appliedPromotions: o.promos, placedAt: o.paymentStatus === "paid" ? o.createdAt : null, createdAt: o.createdAt, updatedAt: o.createdAt },
  customer: { id: null, phone: o.phone, email: o.email, status: null, paidOrders: 3, lifetimeValueMinor: 61_200_000 },
  items: o.items.map((i, n) => ({ id: `${o.id}-i${n}`, titleSnapshot: i.title, skuSnapshot: i.sku, optionsSnapshot: i.options, quantity: i.qty, unitPriceMinor: i.unit, discountMinor: 0, lineTotalMinor: i.unit * i.qty, image: null })),
  timeline: o.timeline.map(([from, to, note], n) => ({ id: `${o.id}-t${n}`, fromStatus: from, toStatus: to, actorType: "system", actorId: null, note: note ?? null, createdAt: EVENT_TIMES[Math.min(n, 2)] })),
  payments: [{ id: `${o.id}-p`, provider: "paystack", reference: `ref-${o.number}`, method: o.method, status: o.paymentStatus === "paid" || o.paymentStatus === "refunded" ? "succeeded" : "pending", amountMinor: orderTotal(o), currency: "NGN", paidAt: null, createdAt: o.createdAt }],
  delivery: o.deliveryMethod === "pickup" ? null : { carrier: null, riderName: o.rider, riderPhoneE164: o.riderPhone, trackingReference: null, estimatedDeliveryAt: null, zone: "Same-day" },
  refunds: o.refunds, notes: o.notes, allowedTransitions: allowedFor(o),
});
seedAdminOrders();

// ---- admin settings: the store, payments and policies, and two delivery zones
const adminSettings = {};
let adminZones = [];
let payout = null;
const BANKS = [{ name: "Access Bank", code: "044" }, { name: "GTBank", code: "058" }, { name: "Zenith Bank", code: "057" }];
const ACCOUNTS = { "0123456789": "JETTY HAIR LTD" };
function seedAdminSettings() {
  payout = null;
  adminSettings.store = { name: "Jetty's Hair", contactEmail: "hello@example.com", contactPhone: "+2348031234567", whatsappNumber: "+2348031234567", showroomAddress: "Lekki Phase 1, Lagos", showroomHours: "Mon–Sat, 9am–7pm" };
  adminSettings.policies = { returnWindowDays: 7, podMaxOrderMinor: null };
  adminSettings.payments = { enabledMethods: ["card", "bank_transfer"], cardHoldMinutes: 30, transferHoldMinutes: 120 };
  const zone = (n, over) => ({ id: id(700 + n), timezone: "Africa/Lagos", sameDayCutoffLocal: null, sameDayFeeMinor: null, nextDayFeeMinor: null, nationwideFeeMinor: null, pickupEnabled: false, active: true, areas: [], ...over });
  adminZones = [
    zone(1, { name: "Lagos Mainland", state: "Lagos", areas: ["Yaba", "Ikeja", "Surulere"], sameDayFeeMinor: 350_000, sameDayCutoffLocal: "14:00", nextDayFeeMinor: 200_000, pickupEnabled: true }),
    zone(2, { name: "Abuja", state: "FCT", nextDayFeeMinor: 500_000, nationwideFeeMinor: 800_000 }),
  ];
}
seedAdminSettings();

// ---- admin customers
const CUSTOMERS = [
  { id: id(800), name: "Adaeze Okafor", area: "Lekki", state: "Lagos", phone: "+2348030000000", email: "adaeze@example.com", orderCount: 7, ltv: 61_200_000, lastOrderAt: "2026-10-20T09:00:00Z", createdAt: "2026-03-02T10:00:00Z", segments: ["vip", "returning"] },
  { id: id(801), name: "Tolu Bello", area: "Yaba", state: "Lagos", phone: "+2348031111111", email: null, orderCount: 1, ltv: 17_600_000, lastOrderAt: "2026-10-18T09:00:00Z", createdAt: "2026-10-18T08:00:00Z", segments: ["new"] },
  { id: id(802), name: null, area: null, state: null, phone: null, email: "quiet@example.com", orderCount: 0, ltv: 0, lastOrderAt: null, createdAt: "2026-09-01T08:00:00Z", segments: [] },
  { id: id(803), name: "Ngozi Eze", area: "Ikeja", state: "Lagos", phone: "+2348032222222", email: "ngozi@example.com", orderCount: 2, ltv: 9_250_000, lastOrderAt: "2026-04-01T09:00:00Z", createdAt: "2026-02-01T08:00:00Z", segments: ["returning", "lapsed"] },
];
const customerRow = (c) => ({ id: c.id, name: c.name, area: c.area, state: c.state, phone: c.phone, email: c.email, status: "active", phoneVerified: !!c.phone, orderCount: c.orderCount, lifetimeValueMinor: c.ltv, lastOrderAt: c.lastOrderAt, createdAt: c.createdAt, segments: c.segments });

// ---- admin reviews
let adminReviews = [];
function seedReviews() {
  const r = (n, over) => ({ id: id(950 + n), productId: V(1), productTitle: "Bone Straight HD Frontal", productSlug: "bone-straight", orderNumber: `JH-102${n}`, image: null, customerPhone: null, customerEmail: "a•••@example.com", rating: 5, title: "Lace disappeared on my skin", body: "Installed it myself in under an hour.", location: "Lekki", status: "pending", verifiedBuyer: true, variant: { Length: '20"', Density: "180%" }, createdAt: `2026-10-2${n}T09:00:00Z`, moderatedAt: null, ...over });
  adminReviews = [
    r(1, {}),
    r(2, { productTitle: "Pixie Curl Bob", rating: 4, title: "Cute and light", body: "Very soft. Call me on 0803 000 0000 if you need a model!", variant: { Colour: "1B" }, location: "Abuja" }),
    r(3, { productTitle: "Kinky Curly Glueless", rating: 2, title: "Arrived later than promised", body: "Hair is lovely but delivery took 6 days instead of 4.", location: "Port Harcourt" }),
    r(4, { productTitle: "Silk Sleep Bonnet", title: "Fits over a 26\" wig", body: "Roomy and soft.", variant: { Colour: "Champagne" } }),
    r(5, { status: "approved", title: "My third unit from Jetty", body: "Consistent quality." }),
    r(6, { status: "hidden", rating: 1, title: "Rude", body: "…" }),
  ];
}
seedReviews();

// ---- admin promotions (dates are relative to now so the calendar always has something in this month)
let promos = [];
const day = 86_400_000;
const isoOffset = (offset) => new Date(Date.now() + offset * day).toISOString();
function seedPromos() {
  const p = (n, over) => ({ id: id(970 + n), name: "Promo", kind: "percentage", status: "active", configuration: { version: 1, percent: 10 }, scope: {}, startsAt: null, endsAt: null, priority: 0, stackable: false, totalUsageLimit: null, perCustomerLimit: 1, usageCount: 0, firstOrderOnly: false, minimumSubtotalMinor: null, codes: [], createdAt: isoOffset(-20 + n), ...over });
  promos = [
    p(1, { name: "BOGO · Bob wigs", kind: "buy_x_get_y", configuration: { version: 1, buy: 1, get: 1, percentOff: 100 }, startsAt: isoOffset(-3), endsAt: isoOffset(5), usageCount: 74 }),
    p(2, { name: "FLASH15 · Frontals", status: "active", startsAt: isoOffset(2), endsAt: isoOffset(4), codes: [{ id: "c1", code: "FLASH15", maxRedemptions: null, active: true }] }),
    p(3, { name: "Summer sale", kind: "fixed_amount", configuration: { version: 1, amountMinor: 500_000 }, startsAt: isoOffset(-30), endsAt: isoOffset(-10), usageCount: 31 }),
    p(4, { name: "Free delivery weekend", kind: "free_delivery", configuration: { version: 1 }, status: "draft" }),
  ];
}
const lifecycle = (x) => (x.status === "draft" ? "draft" : x.status === "inactive" ? "inactive" : x.endsAt && Date.parse(x.endsAt) <= Date.now() ? "ended" : x.startsAt && Date.parse(x.startsAt) > Date.now() ? "scheduled" : "live");
const promoRow = (x) => ({ id: x.id, name: x.name, kind: x.kind, status: lifecycle(x), startsAt: x.startsAt, endsAt: x.endsAt, priority: x.priority, stackable: x.stackable, type: x.codes.length ? "code" : "automatic", usage: { redemptions: x.usageCount, openHolds: 0, limit: x.totalUsageLimit }, createdAt: x.createdAt });
const promoDetail = (x) => ({ promotion: { ...x, lifecycle: lifecycle(x), codes: undefined }, codes: x.codes, stats: { redemptions: x.usageCount, discountMinor: x.usageCount * 1_500_000, orderRevenueMinor: x.usageCount * 21_000_000, openHolds: 0 } });
seedPromos();

// ---- admin storefront content
let content = [];
let contentCounter = 0;
function seedContent() {
  contentCounter = 0;
  const c = (type, title, body, over = {}) => ({ id: id(1000 + ++contentCounter), contentType: type, slug: `${type}-${contentCounter}`, title, body, status: "published", startsAt: null, endsAt: null, sortOrder: contentCounter * 10, updatedAt: "2026-10-20T09:00:00Z", ...over });
  content = [
    c("home_layout", "Home layout", { sections: [{ type: "stories", enabled: true }, { type: "hero", enabled: true }, { type: "flash", enabled: false }, { type: "products", enabled: true }, { type: "length", enabled: true }, { type: "tiles", enabled: true }, { type: "trust", enabled: true }] }),
    c("announcement", "Free delivery over ₦250,000", { text: "Free delivery over ₦250,000", linkUrl: "/shop" }),
    c("announcement", "Weekend sale", { text: "Weekend sale: 10% off frontals" }, { status: "draft" }),
    c("banner", "Wigs you will love", { headline: "Wigs you will love", tone: "pink", ctaLabel: "Shop now", ctaUrl: "/shop" }),
    c("banner", "New bobs", { headline: "New bobs", tone: "blush" }),
    c("story", "New in", { title: "New in", linkUrl: "/shop?sort=newest" }),
    c("page", "Returns policy", { markdown: "# Returns\n\nYou have **7 days** to return an unworn wig." }, { slug: "returns" }),
    c("page", "Delivery", { markdown: "# Delivery\n\nNext-day in Lagos." }, { slug: "delivery" }),
    c("page", "Terms", { markdown: "# Terms\n\nDraft." }, { slug: "terms", status: "draft" }),
  ];
}
const withImage = (x) => ({ ...x, image: x.body.imageObjectKey ? { objectKey: x.body.imageObjectKey, url: `http://localhost:${PORT}/api/v1/__media/${x.body.imageObjectKey}` } : null });
seedContent();

// ---- admin categories and collections
let cats = [];
let cols = [];
let colMembers = {};
function seedTaxonomy() {
  cats = [
    { id: id(40), name: "Frontal wigs", slug: "frontal", parentId: null, sortOrder: 0, active: true, productCount: 12 },
    { id: id(41), name: "Hair care", slug: "hair-care", parentId: null, sortOrder: 10, active: true, productCount: 4 },
    { id: id(42), name: "HD lace", slug: "hd-lace", parentId: id(40), sortOrder: 0, active: true, productCount: 5 },
  ];
  cols = [{ id: id(60), name: "Bob wigs", slug: "bob-wigs", description: null, sortOrder: 0, active: true }, { id: id(61), name: "Frontals", slug: "frontals", description: "Our frontals", sortOrder: 10, active: true }];
  colMembers = { [id(60)]: [V(1)], [id(61)]: [] };
}
seedTaxonomy();
const memberRows = (cid) => (colMembers[cid] ?? []).map((pid) => ({ id: pid, title: adminProducts.get(pid)?.title ?? "Product", status: adminProducts.get(pid)?.status ?? "active" }));

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
  res.setHeader("Access-Control-Expose-Headers", "ETag, X-Request-Id, Retry-After");
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
      if (path === "/admin/categories") return can(a, "catalog:read") ? send(200, { data: cats }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      if (path === "/admin/products") {
        if (!can(a, "catalog:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const status = url.searchParams.get("status");
        const stock = url.searchParams.get("stock");
        const rows = [...adminProducts.values()].map(productRow).filter((r) => (!q || r.title.toLowerCase().includes(q)) && (!status || r.status === status) && (stock !== "out" || r.availableQuantity <= 0) && (stock !== "low" || r.lowStock));
        const live = [...adminProducts.values()].filter((p) => p.status !== "archived");
        const summary = { products: live.length, variants: live.reduce((n, p) => n + p.variants.filter((v) => v.active).length, 0), lowStock: live.filter((p) => p.variants.some((v) => v.active && v.stock.onHand <= 1)).length };
        return send(200, { summary, data: rows, page: { nextCursor: null } });
      }
      const adminProduct = path.match(/^\/admin\/products\/([^/]+)$/);
      if (adminProduct) {
        const p = adminProducts.get(adminProduct[1]);
        if (!p) return send(404, { error: { code: "NOT_FOUND", message: "Product not found.", requestId: "r" } });
        res.setHeader("ETag", etagOfProduct(p));
        return send(200, productDetail(p));
      }
      if (path === "/admin/payouts/account") return can(a, "settings:read") ? send(200, payout ? { configured: true, mode: "test", ...payout } : { configured: false, mode: "test" }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      if (path === "/admin/payouts/banks") return can(a, "settings:write") ? send(200, { data: BANKS }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      const settingGet = path.match(/^\/admin\/settings\/([^/]+)$/);
      if (settingGet) {
        if (!can(a, "settings:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        if (settingGet[1] === "delivery-zones") return send(200, { zones: adminZones });
        return adminSettings[settingGet[1]] ? send(200, adminSettings[settingGet[1]]) : send(404, { error: { code: "NOT_FOUND", message: "Unknown setting.", requestId: "r" } });
      }
      if (path === "/admin/customers/segments") return can(a, "customers:read") ? send(200, { everyone: 1842, segments: [{ key: "vip", label: "VIP", rule: "5 or more orders, or ₦1,000,000 spent", count: 64 }, { key: "new", label: "New", rule: "First order in the last 30 days", count: 231 }, { key: "returning", label: "Returning", rule: "2 or more orders", count: 610 }, { key: "lapsed", label: "Lapsed", rule: "No order in the last 120 days", count: 402 }] }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      if (path === "/admin/customers") {
        if (!can(a, "customers:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const segment = url.searchParams.get("segment");
        const rows = CUSTOMERS.filter((c) => (!segment || c.segments.includes(segment)) && (!q || [c.phone, c.email].some((x) => x && x.toLowerCase().includes(q))));
        return send(200, { data: rows.map(customerRow), page: { nextCursor: null } });
      }
      const customerGet = path.match(/^\/admin\/customers\/([^/]+)$/);
      if (customerGet) {
        if (!can(a, "customers:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const c = CUSTOMERS.find((x) => x.id === customerGet[1]);
        if (!c) return send(404, { error: { code: "NOT_FOUND", message: "Customer not found.", requestId: "r" } });
        return send(200, {
          customer: { id: c.id, phone: c.phone, email: c.email, status: "active", phoneVerifiedAt: null, emailVerifiedAt: null, createdAt: c.createdAt },
          lastOrder: c.name ? { name: c.name, area: c.area, state: c.state, addressLine: "14 Admiralty Way" } : null,
          orderCount: c.orderCount, lifetimeValueMinor: c.ltv, lastOrderAt: c.lastOrderAt,
          recentOrders: c.orderCount ? [{ id: O(1), orderNumber: "JH-10481", status: "placed", paymentStatus: "paid", totalMinor: 20_000_000, createdAt: "2026-10-20T09:00:00Z" }, { id: O(4), orderNumber: "JH-10484", status: "delivered", paymentStatus: "paid", totalMinor: 9_250_000, createdAt: "2026-09-02T09:00:00Z" }] : [],
        });
      }
      if (path === "/admin/collections") return can(a, "catalog:read") || can(a, "promotions:read") ? send(200, { data: cols.map((c) => ({ ...c, productCount: (colMembers[c.id] ?? []).length })) }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      const colProducts = path.match(/^\/admin\/collections\/([^/]+)\/products$/);
      if (colProducts) return send(200, { data: memberRows(colProducts[1]) });
      if (path === "/admin/promotions") {
        if (!can(a, "promotions:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        return send(200, { data: [...promos].reverse().map(promoRow), page: { nextCursor: null } });
      }
      const promoGet = path.match(/^\/admin\/promotions\/([^/]+)$/);
      if (promoGet) {
        const x = promos.find((q) => q.id === promoGet[1]);
        return can(a, "promotions:read") ? (x ? send(200, promoDetail(x)) : send(404, { error: { code: "NOT_FOUND", message: "Promotion not found.", requestId: "r" } })) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      }
      if (path === "/admin/content") {
        if (!can(a, "content:read") && !can(a, "content:write")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const type = url.searchParams.get("type");
        return send(200, { data: content.filter((x) => !type || x.contentType === type).map(withImage), page: { nextCursor: null } });
      }
      if (path === "/admin/dashboard" || path === "/admin/analytics/revenue") {
        if (!can(a, "analytics:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const to = new Date(url.searchParams.get("to") ?? Date.now());
        const from = new Date(url.searchParams.get("from") ?? to.getTime() - 30 * 86_400_000);
        const days = Math.max(1, Math.round((to - from) / 86_400_000));
        if (path === "/admin/analytics/revenue") {
          const series = (offset) => Array.from({ length: days }, (_, i) => ({ bucket: new Date(from.getTime() - offset * days * 86_400_000 + i * 86_400_000).toISOString().slice(0, 10), orders: 4 + (i % 5), revenueMinor: (4 + (i % 5)) * 21_000_000 + (offset ? 0 : i * 500_000) }));
          return send(200, { interval: "day", current: series(0), previous: series(1) });
        }
        // A range that ends in the past (a custom one) has no sales: it shows the empty states.
        const quiet = to.getTime() < Date.now() - 86_400_000 * 2;
        const cmp = (current, previous, changePct) => ({ current, previous, changePct });
        return send(200, {
          range: { from: from.toISOString(), to: to.toISOString(), previous: { from: from.toISOString(), to: from.toISOString() } },
          kpis: quiet
            ? { revenueMinor: cmp(0, 0, null), orders: cmp(0, 0, null), averageOrderValueMinor: cmp(0, 0, null), conversionRatePct: cmp(null, null, null), sessions: cmp(null, null, null) }
            : { revenueMinor: cmp(4_860_000_000, 4_105_000_000, 18.4), orders: cmp(231, 206, 12.1), averageOrderValueMinor: cmp(21_040_000, 19_930_000, 5.6), conversionRatePct: cmp(2.4, 2.7, -11.1), sessions: cmp(9640, 9100, 5.9) },
          actionCounts: { toPack: 3, toDispatch: 2, outForDelivery: 1, awaitingTransfer: 1, paymentExceptions: 0 },
          topProducts: quiet ? [] : [
            { productId: V(1), title: "Bone Straight HD Frontal", units: 64, revenueMinor: 1_240_000_000, image: null, availableQuantity: 38, lowStock: false },
            { productId: V(2), title: "Kinky Curly Glueless", units: 39, revenueMinor: 620_000_000, image: null, availableQuantity: 6, lowStock: true },
          ],
          salesByCategory: [],
          funnel: quiet ? null : { sessions: 9640, viewedProduct: 5210, addedToBag: 1180, checkout: 448, purchased: 231 },
          customers: quiet ? { newBuyers: 0, returningBuyers: 0, topStates: [] } : { newBuyers: 142, returningBuyers: 89, topStates: [{ state: "Lagos", orders: 157, sharePct: 68 }, { state: "FCT", orders: 39, sharePct: 17 }] },
          campaigns: quiet ? [] : [{ id: id(900), name: "BOGO · Bob wigs", kind: "buy_x_get_y", viaCode: false, endsAt: "2026-10-31T22:59:00Z", orders: 74, revenueMinor: 580_000_000 }, { id: id(901), name: "FLASH15 · Frontals", kind: "percentage", viaCode: true, endsAt: null, orders: 22, revenueMinor: 340_000_000 }],
        });
      }
      if (path === "/admin/orders") {
        if (!can(a, "orders:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const statuses = (url.searchParams.get("status") ?? "").split(",").filter(Boolean);
        const method = url.searchParams.get("method");
        const from = url.searchParams.get("from");
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const base = [...adminOrders.values()].filter((o) => (!q || [o.number, o.recipient, o.phone].some((x) => x.toLowerCase().includes(q))) && (!method || o.method === method) && (!from || o.createdAt >= from)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
        const counts = {};
        for (const o of base) counts[o.status] = (counts[o.status] ?? 0) + 1;
        const matching = base.filter((o) => !statuses.length || statuses.includes(o.status));
        const page = matching.slice(cursor, cursor + limit);
        return send(200, { counts: cursor ? null : counts, data: page.map(orderRow), page: { nextCursor: cursor + limit < matching.length ? String(cursor + limit) : null } });
      }
      const adminOrder = path.match(/^\/admin\/orders\/([^/]+)$/);
      if (adminOrder) {
        if (!can(a, "orders:read")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const o = adminOrders.get(adminOrder[1]);
        return o ? send(200, orderDetail(o)) : send(404, { error: { code: "NOT_FOUND", message: "Order not found.", requestId: "r" } });
      }
      if (path === "/admin/reviews/summary") return can(a, "reviews:moderate") ? send(200, { count: 2140, average: 4.8, distribution: [{ stars: 5, count: 1755 }, { stars: 4, count: 257 }, { stars: 3, count: 64 }, { stars: 2, count: 43 }, { stars: 1, count: 21 }] }) : send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
      if (path === "/admin/reviews") {
        if (!can(a, "reviews:moderate")) return send(403, { error: { code: "FORBIDDEN", message: "No access", requestId: "r" } });
        const status = url.searchParams.get("status");
        const rows = adminReviews.filter((x) => !status || x.status === status);
        const limit = Number(url.searchParams.get("limit") ?? 20);
        return send(200, { data: rows.slice(0, limit), page: { total: url.searchParams.get("cursor") ? null : rows.length, nextCursor: null } });
      }
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
  if ((path.startsWith("/admin/") && !path.startsWith("/admin/auth/") || path.startsWith("/__test/touch-product/") || path === "/__test/reset-products" || path === "/__test/reset-orders" || path === "/__test/reset-promotions" || path === "/__test/reset-taxonomy" || path === "/__test/reset-content" || path === "/__test/reset-settings" || path === "/__test/reset-reviews" || path.startsWith("/__upload/")) && ["PATCH", "PUT", "POST", "DELETE"].includes(req.method)) {
    if (path === "/__test/reset-products") { seedAdminProducts(); return send(204); }
    if (path === "/__test/reset-orders") { seedAdminOrders(); return send(204); }
    if (path === "/__test/reset-promotions") { seedPromos(); return send(204); }
    if (path === "/__test/reset-taxonomy") { seedTaxonomy(); return send(204); }
    if (path === "/__test/reset-content") { seedContent(); return send(204); }
    if (path === "/__test/reset-settings") { seedAdminSettings(); return send(204); }
    if (path.startsWith("/__upload/")) return send(200);
    if (path === "/__test/reset-reviews") { seedReviews(); return send(204); }
    const touchPath = path.match(/^\/__test\/touch-product\/(.+)$/);
    if (touchPath) { const p = adminProducts.get(touchPath[1]); if (p) p.version += 5000; return send(204); }
    const a = adminFrom(req);
    if (!a) return send(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required.", requestId: "r" } });
    const json = body ? JSON.parse(body) : {};
    const fail = (status, code, message) => send(status, { error: { code, message, requestId: "r" } });
    const touch = (p) => { p.version += 1000; res.setHeader("ETag", etagOfProduct(p)); };
    const inv = path.match(/^\/admin\/inventory\/([^/]+)$/);
    if (inv && req.method === "PATCH") {
      for (const p of adminProducts.values()) {
        const v = p.variants.find((x) => x.id === inv[1]);
        if (!v) continue;
        const target = json.mode === "set" ? json.quantity : v.stock.onHand + json.quantity;
        if (target < v.stock.reserved) return fail(409, "STOCK_BELOW_RESERVED", "Units are held by open orders; on-hand cannot go below that.");
        v.stock.onHand = target;
        if (json.lowStockThreshold !== undefined) v.stock.lowStockThreshold = json.lowStockThreshold;
        return send(200, { variantId: v.id, onHand: v.stock.onHand, reserved: v.stock.reserved, available: v.stock.onHand - v.stock.reserved, lowStockThreshold: v.stock.lowStockThreshold });
      }
      return fail(404, "NOT_FOUND", "Variant not found.");
    }
    if (path === "/admin/products" && req.method === "POST") {
      const n = adminProducts.size + 1;
      const p = { id: V(300 + n), title: json.title, slug: json.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), status: "draft", featured: false, description: null, version: 1_700_000_000_000 + 300 + n, categoryIds: [], media: [], options: [], variants: [] };
      adminProducts.set(p.id, p);
      res.setHeader("ETag", etagOfProduct(p));
      return send(201, productDetail(p));
    }
    if (path === "/admin/payouts/resolve" && req.method === "POST") {
      if (!can(a, "settings:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      return ACCOUNTS[json.accountNumber] ? send(200, { accountName: ACCOUNTS[json.accountNumber] }) : fail(422, "ACCOUNT_NOT_FOUND", "We could not find that account. Check the bank and the account number.");
    }
    if (path === "/admin/payouts/account" && req.method === "PUT") {
      if (!can(a, "settings:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const bank = BANKS.find((b) => b.code === json.bankCode);
      if (!bank || !ACCOUNTS[json.accountNumber]) return fail(422, "ACCOUNT_NOT_FOUND", "We could not find that account. Check the bank and the account number.");
      payout = { subaccountCode: "ACCT_mock", businessName: json.businessName, bankCode: bank.code, bankName: bank.name, accountName: ACCOUNTS[json.accountNumber], accountLast4: json.accountNumber.slice(-4), updatedAt: new Date().toISOString() };
      return send(200, { configured: true, mode: "test", ...payout });
    }
    const reviewPatch = path.match(/^\/admin\/reviews\/([^/]+)$/);
    if (reviewPatch && req.method === "PATCH") {
      if (!can(a, "reviews:moderate")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const r = adminReviews.find((x) => x.id === reviewPatch[1]);
      if (!r) return fail(404, "NOT_FOUND", "Review not found.");
      r.status = json.status;
      return send(200, { id: r.id, status: r.status });
    }
    if (path === "/admin/promotions" && req.method === "POST") {
      if (!can(a, "promotions:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      if (json.codes?.some((c) => promos.some((x) => x.codes.some((y) => y.code === c.code.toUpperCase())))) return fail(409, "CODE_TAKEN", "One of these codes is already used by another promotion.");
      const x = { id: id(990 + promos.length), status: "draft", priority: 0, usageCount: 0, createdAt: new Date().toISOString(), ...json, codes: (json.codes ?? []).map((c, i) => ({ id: `c${i}`, code: c.code.toUpperCase(), maxRedemptions: null, active: true })) };
      promos.push(x);
      return send(201, promoDetail(x));
    }
    const promoAct = path.match(/^\/admin\/promotions\/([^/]+)(?:\/(activate|deactivate))?$/);
    if (promoAct && ["PATCH", "POST"].includes(req.method)) {
      if (!can(a, "promotions:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const x = promos.find((q) => q.id === promoAct[1]);
      if (!x) return fail(404, "NOT_FOUND", "Promotion not found.");
      if (promoAct[2]) x.status = promoAct[2] === "activate" ? "active" : "inactive";
      else { const { codes, ...rest } = json; Object.assign(x, rest); if (codes) for (const c of codes) if (!x.codes.some((y) => y.code === c.code.toUpperCase())) x.codes.push({ id: `c${x.codes.length}`, code: c.code.toUpperCase(), maxRedemptions: null, active: true }); }
      return send(200, promoDetail(x));
    }
    if (path === "/admin/media/content-upload-intents" && req.method === "POST") {
      if (!can(a, "content:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const key = `content/upload-${++contentCounter}.webp`;
      return send(200, { objectKey: key, upload: { method: "PUT", url: `http://localhost:${PORT}/api/v1/__upload/${key}`, headers: {}, expiresAt: new Date(Date.now() + 300_000).toISOString() } });
    }
    if (path === "/admin/content" && req.method === "POST") {
      if (!can(a, "content:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const x = { id: id(1100 + ++contentCounter), slug: `${json.contentType}-${contentCounter}`, sortOrder: 0, startsAt: null, endsAt: null, status: "draft", updatedAt: new Date().toISOString(), ...json };
      content.push(x);
      return send(201, withImage(x));
    }
    const contentPatch = path.match(/^\/admin\/content\/([^/]+)$/);
    if (contentPatch && req.method === "PATCH") {
      if (!can(a, "content:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const x = content.find((q) => q.id === contentPatch[1]);
      if (!x) return fail(404, "NOT_FOUND", "Content entry not found.");
      Object.assign(x, json, { updatedAt: new Date().toISOString() });
      return send(200, withImage(x));
    }
    if (path === "/admin/categories" && req.method === "POST") {
      if (!can(a, "catalog:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      if (cats.some((c) => c.slug === (json.slug ?? json.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")))) return fail(409, "SLUG_TAKEN", "Another category already uses this slug.");
      const x = { id: id(1300 + cats.length), name: json.name, slug: json.slug ?? json.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), parentId: json.parentId ?? null, sortOrder: json.sortOrder ?? 0, active: json.active ?? true, productCount: 0 };
      cats.push(x);
      return send(201, x);
    }
    const catPatch = path.match(/^\/admin\/categories\/([^/]+)$/);
    if (catPatch && req.method === "PATCH") {
      const x = cats.find((c) => c.id === catPatch[1]);
      if (!x) return fail(404, "NOT_FOUND", "Category not found.");
      Object.assign(x, json);
      return send(200, x);
    }
    if (path === "/admin/collections" && req.method === "POST") {
      if (!can(a, "catalog:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const x = { id: id(1400 + cols.length), name: json.name, slug: json.slug ?? json.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: json.description ?? null, sortOrder: json.sortOrder ?? 0, active: json.active ?? true };
      cols.push(x);
      colMembers[x.id] = [];
      return send(201, { ...x, productCount: 0 });
    }
    const colMember = path.match(/^\/admin\/collections\/([^/]+)\/products$/);
    if (colMember && req.method === "PUT") { colMembers[colMember[1]] = json.productIds; return send(200, { productIds: json.productIds }); }
    const colPatch = path.match(/^\/admin\/collections\/([^/]+)$/);
    if (colPatch && req.method === "PATCH") {
      const x = cols.find((c) => c.id === colPatch[1]);
      if (!x) return fail(404, "NOT_FOUND", "Collection not found.");
      Object.assign(x, json);
      return send(200, { ...x, productCount: (colMembers[x.id] ?? []).length });
    }
    const settingPatch = path.match(/^\/admin\/settings\/([^/]+)$/);
    if (settingPatch && req.method === "PATCH") {
      if (!can(a, "settings:write")) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      if (settingPatch[1] === "delivery-zones") {
        for (const z of json.zones) {
          const at = adminZones.findIndex((x) => x.id === z.id);
          if (at >= 0) adminZones[at] = { ...adminZones[at], ...z };
          else adminZones.push({ id: id(750 + adminZones.length), timezone: "Africa/Lagos", active: true, areas: [], sameDayCutoffLocal: null, sameDayFeeMinor: null, nextDayFeeMinor: null, nationwideFeeMinor: null, pickupEnabled: false, ...z });
        }
        return send(200, { zones: adminZones });
      }
      if (json.name === "") return fail(422, "VALIDATION_FAILED", "name is not allowed to be empty");
      adminSettings[settingPatch[1]] = { ...adminSettings[settingPatch[1]], ...json };
      return send(200, adminSettings[settingPatch[1]]);
    }
    const orderPath = path.match(/^\/admin\/orders\/([^/]+)\/(status|notes|confirm-transfer|refunds|cancel|delivery)$/);
    if (orderPath) {
      const o = adminOrders.get(orderPath[1]);
      if (!o) return fail(404, "NOT_FOUND", "Order not found.");
      const [, , action] = orderPath;
      const need = { status: "orders:fulfil", notes: "orders:read", "confirm-transfer": "orders:write", refunds: "orders:refund", cancel: "orders:cancel", delivery: "orders:fulfil" }[action];
      if (!can(a, need) && !(need === "orders:fulfil" && can(a, "orders:write"))) return fail(403, "FORBIDDEN", "You do not have permission to do that.");
      const event = (to, note) => o.timeline.push([o.status, to, note]);
      if (action === "notes") { o.notes.push({ id: `${o.id}-n${o.notes.length}`, at: new Date().toISOString(), adminUserId: id(600), note: json.note }); return send(204); }
      if (action === "delivery") { if ("riderName" in json) o.rider = json.riderName; if ("riderPhoneE164" in json) o.riderPhone = json.riderPhoneE164; return send(200, { riderName: o.rider }); }
      if (action === "status") {
        if (!allowedFor(o).includes(json.status)) return fail(409, "INVALID_TRANSITION", `An order that is ${o.status.replaceAll("_", " ")} cannot move to ${json.status.replaceAll("_", " ")}.`);
        event(json.status); o.status = json.status;
        return send(200, orderDetail(o));
      }
      if (action === "confirm-transfer") {
        if (o.paymentStatus === "paid") return send(200, { outcome: "already_paid", mode: "none", status: o.status, paymentStatus: o.paymentStatus });
        if (!json.manualReason) return fail(409, "TRANSFER_NOT_CONFIRMED", "The payment provider has not received this transfer. Provide a reason to confirm it manually.");
        if (json.manualReason.length < 10) return fail(422, "VALIDATION_FAILED", "manualReason is too short");
        event("placed"); o.status = "placed"; o.paymentStatus = "paid";
        return send(200, { outcome: "paid", mode: "manual", status: "placed", paymentStatus: "paid" });
      }
      if (action === "cancel") {
        if (!["pending_payment", "placed", "packed"].includes(o.status)) return fail(409, "INVALID_TRANSITION", "This order can no longer be cancelled.");
        event("cancelled", json.reason); o.status = "cancelled";
        return send(200, orderDetail(o));
      }
      if (action === "refunds") {
        if (!req.headers["idempotency-key"]) return fail(400, "VALIDATION_FAILED", "Idempotency-Key is required");
        const left = orderTotal(o) - o.refunds.reduce((n, r) => n + r.amountMinor, 0);
        const amount = json.amountMinor ?? left;
        if (amount > left) return fail(422, "REFUND_REJECTED", "That is more than is left to refund.");
        o.refunds.push({ id: `${o.id}-r${o.refunds.length}`, paymentAttemptId: `${o.id}-p`, amountMinor: amount, reason: json.reason, status: "processing", createdAt: new Date().toISOString() });
        if (amount === left) { event("refunded", "REFUNDED_IN_FULL"); o.status = "refunded"; o.paymentStatus = "refunded"; } else event(o.status, "PARTIAL_REFUND");
        return send(201, { ok: true, amountMinor: amount });
      }
    }
    const target = path.match(/^\/admin\/products\/([^/]+)(\/(variants|publish|archive))?$/);
    if (target && adminProducts.has(target[1])) {
      const p = adminProducts.get(target[1]);
      const sub = target[3];
      const needsMatch = (req.method === "PATCH" && !sub) || sub === "variants";
      if (needsMatch) {
        if (!req.headers["if-match"]) return fail(428, "PRECONDITION_REQUIRED", "If-Match is required.");
        if (req.headers["if-match"] !== etagOfProduct(p)) return fail(412, "PRECONDITION_FAILED", "This record changed.");
      }
      if (sub === "publish") { if (!p.variants.some((v) => v.active)) return fail(422, "PRODUCT_NOT_PUBLISHABLE", "Needs an active variant."); p.status = "active"; }
      else if (sub === "archive") p.status = "archived";
      else if (sub === "variants") {
        const prior = new Map(p.variants.map((v) => [v.id, v]));
        p.options = json.options.map((o) => ({ id: `opt-${o.name}`, name: o.name, values: o.values.map((v) => ({ id: `val-${v.valueKey}`, label: v.label, valueKey: v.valueKey, priceDeltaMinor: v.priceDeltaMinor ?? 0, swatch: v.swatch ?? null, active: v.active ?? true })) }));
        p.variants = json.variants.map((v, i) => { const old = v.id ? prior.get(v.id) : null; return { id: old?.id ?? V(1000 + adminProducts.size * 100 + i + Math.floor(Math.random() * 1e6)), sku: v.sku, optionValues: v.optionValues, priceMinor: v.priceMinor, compareAtPriceMinor: v.compareAtPriceMinor ?? null, active: v.active ?? true, stock: old ? old.stock : { onHand: v.stock ?? 0, reserved: 0, lowStockThreshold: null } }; });
      } else {
        for (const k of ["title", "description", "featured", "tags"]) if (k in json) p[k] = json[k];
        if (json.categoryIds) p.categoryIds = json.categoryIds;
      }
      touch(p);
      return send(200, productDetail(p));
    }
    return fail(404, "NOT_FOUND", "Not found.");
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
