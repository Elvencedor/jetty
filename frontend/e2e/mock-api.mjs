// A small stand-in for the hapi API, so browser tests need no database. It serves a fixed catalogue in the same
// shapes as docs/API.md. Run by Playwright's webServer; start by hand with `node e2e/mock-api.mjs`.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);
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
    if (path === "/health") return send(200, { ok: true });
    if (path === "/storefront/home") return send(200, { data: home });
    if (path === "/storefront/settings") return send(200, { data: settings });
    if (path === "/categories") return send(200, { data: { categories: [{ id: "c1", slug: "frontal", name: "Frontal wigs", children: [] }], collections: [{ id: "k1", slug: "new-arrivals", name: "New arrivals", description: null }] } });
    if (path === "/products") return send(200, listing(url));
    if (path === "/products/facets") return send(200, { data: facets });
    if (path === "/products/suggestions") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return send(200, { data: PRODUCTS.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({ id: p.id, slug: p.slug, title: p.title, image: null })) });
    }
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
    if (path === "/pricing/quote") return send(200, quote(json.items ?? [], json.promotionCodes ?? []));
    if (path === "/delivery/quotes") {
      return send(200, { currency: "NGN", zone: { id: "z", name: "Lagos", state: json.deliveryAddress?.state ?? "Lagos" }, warnings: [], options: [{ method: "same_day", available: true, baseFeeMinor: 300000, feeMinor: 300000, freeDeliveryPromotionId: null, estimate: { earliestDate: "2026-10-21", latestDate: "2026-10-21" } }] });
    }
    return send(204);
  }
  return send(404, { error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } });
});

server.listen(PORT, () => console.log(`mock API on :${PORT}`));
