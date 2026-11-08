import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { hashPassword } from '../lib/password.js';
import { createProduct, replaceMatrix, setProductStatus, type MatrixInput } from '../modules/admin/products.js';
import { createPromotion, setPromotionState } from '../modules/admin/promotions.js';
import { listZones, upsertZones } from '../modules/admin/zones.js';
import { createDatabase, type Db } from './client.js';
import { MOCK_ANGLES, MOCK_SIZE, mockBannerSvg, mockSvg, mockTextureSvg, type MockKind, type MockSpec } from './mock-media.js';
import { seed } from './seed.js';
import {
  adminUsers,
  categories,
  collections,
  contentEntries,
  customers,
  inventory,
  orderItems,
  orders,
  productMedia,
  productVariants,
  products,
  promotionCodes,
  reviews,
} from './schema/index.js';

/** Local-testing credentials. Printed when seeding, and refused outside development. */
export const DEV_OWNER = { email: 'owner@example.com', password: 'jetty-dev-password' };
export const DEV_CUSTOMER_PASSWORD = 'customer-password';

const naira = (n: number) => n * 100;

type OptionSpec = { name: string; values: { label: string; key: string; swatch?: string }[] };
type ProductSpec = {
  slug: string;
  title: string;
  description: string;
  category: string;
  collections?: string[];
  tags?: string[];
  featured?: boolean;
  badge?: string;
  status?: 'active' | 'draft';
  options: OptionSpec[];
  /** Price of one variant, from its option picks (naira). */
  price: (pick: Record<string, string>) => number;
  /** Compare-at price multiplier, for products on offer. */
  wasMultiplier?: number;
  stock?: number | ((pick: Record<string, string>) => number);
  lowStockThreshold?: number;
};

const lengths = (keys: number[]): OptionSpec => ({ name: 'Length', values: keys.map((k) => ({ label: `${k}"`, key: String(k) })) });
const lace = (...keys: ('hd-frontal' | 'transparent' | '5x5-closure' | '13x4-frontal' | '2x6-closure')[]): OptionSpec => {
  const labels = { 'hd-frontal': 'HD frontal', transparent: 'Transparent lace', '5x5-closure': '5x5 closure', '13x4-frontal': '13x4 frontal', '2x6-closure': '2x6 closure' };
  return { name: 'Lace', values: keys.map((k) => ({ label: labels[k], key: k })) };
};
const density = (...keys: number[]): OptionSpec => ({ name: 'Density', values: keys.map((k) => ({ label: `${k}%`, key: String(k) })) });
const texture = (key: string, label: string): OptionSpec => ({ name: 'Texture', values: [{ label, key }] });
const COLOURS: OptionSpec['values'] = [
  { label: 'Natural black', key: 'natural-black', swatch: '#1b1b1b' },
  { label: 'Honey blonde', key: 'honey-blonde', swatch: '#c9a25a' },
  { label: 'Burgundy', key: 'burgundy', swatch: '#6d1a36' },
  { label: 'Ginger', key: 'ginger', swatch: '#b5651d' },
];
const colour = (...keys: string[]): OptionSpec => ({ name: 'Colour', values: COLOURS.filter((c) => keys.includes(c.key)) });

const lengthPrice = (base: number, step: number) => (pick: Record<string, string>) => {
  const n = Number(pick.Length);
  const dens = pick.Density === '180' ? 25000 : pick.Density === '200' ? 45000 : 0;
  const lace = pick.Lace === 'hd-frontal' ? 15000 : 0;
  return base + (n - 12) * step + dens + lace;
};

export const PRODUCT_SEEDS: ProductSpec[] = [
  {
    slug: 'body-wave-hd-frontal-wig',
    title: 'Body wave HD frontal wig',
    description: 'Soft, bouncy body wave on a 13x4 HD frontal. Pre-plucked hairline with baby hairs, ready to wear. 100% human hair.',
    category: 'frontal',
    collections: ['best-sellers'],
    tags: ['bestseller', 'body wave'],
    featured: true,
    badge: 'Best seller',
    options: [texture('body-wave', 'Body wave'), lace('hd-frontal', 'transparent'), lengths([14, 18, 22, 26]), density(150, 180)],
    price: lengthPrice(120000, 6500),
    stock: 8,
  },
  {
    slug: 'straight-13x4-frontal-wig',
    title: 'Silky straight 13x4 frontal wig',
    description: 'Sleek, glass-like straight hair with a natural parting space. Low maintenance and easy to colour.',
    category: 'frontal',
    collections: ['new-arrivals'],
    tags: ['straight', 'new'],
    featured: true,
    badge: 'New',
    options: [texture('straight', 'Straight'), lace('13x4-frontal'), lengths([12, 16, 20, 24, 30]), density(150, 180)],
    price: lengthPrice(105000, 6000),
    stock: 6,
  },
  {
    slug: 'deep-wave-5x5-closure-wig',
    title: 'Deep wave 5x5 closure wig',
    description: 'Defined deep waves on a 5x5 closure cap. Holds its curl pattern wash after wash.',
    category: 'closure',
    collections: ['on-offer'],
    tags: ['deep wave', 'sale'],
    options: [texture('deep-wave', 'Deep wave'), lace('5x5-closure'), lengths([14, 18, 22, 26]), density(150, 180)],
    price: lengthPrice(95000, 5500),
    wasMultiplier: 1.25,
    stock: 5,
  },
  {
    slug: 'kinky-curly-glueless-wig',
    title: 'Kinky curly glueless wig',
    description: 'Pre-cut lace, elastic band and adjustable straps: put it on and go. Natural 4B-style curls.',
    category: 'glueless',
    collections: ['best-sellers'],
    tags: ['glueless', 'curly'],
    featured: true,
    options: [texture('kinky-curly', 'Kinky curly'), lace('transparent'), lengths([12, 16, 20, 24]), density(150, 180)],
    price: lengthPrice(110000, 5500),
    stock: 10,
  },
  {
    slug: 'bone-straight-glueless-wig',
    title: 'Bone straight glueless wig',
    description: 'Pre-bleached knots, pre-cut lace and a snug fit. Ready in five minutes.',
    category: 'glueless',
    collections: ['new-arrivals'],
    tags: ['glueless', 'straight'],
    options: [texture('straight', 'Straight'), lace('transparent'), lengths([16, 20, 24, 28]), density(150, 180)],
    price: lengthPrice(100000, 5500),
    stock: 7,
  },
  {
    slug: 'classic-bob-wig',
    title: 'Classic blunt-cut bob wig',
    description: 'A sharp, chin-length bob on a 13x4 frontal. Light, cool and easy to style.',
    category: 'bobs',
    collections: ['best-sellers', 'on-offer'],
    tags: ['bob', 'sale'],
    featured: true,
    options: [texture('straight', 'Straight'), lace('13x4-frontal'), lengths([8, 10, 12, 14]), density(150, 180)],
    price: lengthPrice(65000, 4500),
    wasMultiplier: 1.2,
    stock: 12,
  },
  {
    slug: 'wavy-bob-closure-wig',
    title: 'Wavy bob closure wig',
    description: 'Relaxed beach waves in a shoulder-grazing bob. A 5x5 closure keeps the parting flexible.',
    category: 'bobs',
    tags: ['bob', 'wavy'],
    options: [texture('water-wave', 'Water wave'), lace('5x5-closure'), lengths([10, 12, 14]), density(150)],
    price: lengthPrice(70000, 4500),
    stock: 9,
  },
  {
    slug: 'honey-blonde-613-frontal-wig',
    title: 'Honey blonde frontal wig',
    description: 'Pre-coloured honey blonde that is bright without brassiness. Lightly bleached knots.',
    category: 'coloured',
    collections: ['new-arrivals'],
    tags: ['coloured', 'blonde'],
    featured: true,
    badge: 'New',
    options: [texture('straight', 'Straight'), lace('13x4-frontal'), lengths([18, 22, 26]), colour('honey-blonde'), density(180)],
    price: lengthPrice(175000, 7000),
    stock: 4,
  },
  {
    slug: 'colour-pop-straight-wig',
    title: 'Colour pop straight wig',
    description: 'Pick your shade: burgundy, ginger, honey blonde or natural black. Same silky straight finish.',
    category: 'coloured',
    collections: ['on-offer'],
    tags: ['coloured', 'sale'],
    options: [texture('straight', 'Straight'), lace('13x4-frontal'), lengths([16, 20, 24]), colour('natural-black', 'honey-blonde', 'burgundy', 'ginger'), density(150)],
    price: (p) => lengthPrice(135000, 6500)(p) + (p.Colour === 'natural-black' ? 0 : 20000),
    wasMultiplier: 1.3,
    stock: 3,
  },
  {
    slug: 'edge-control-gel',
    title: 'Strong-hold edge control',
    description: 'A flake-free, non-greasy hold for baby hairs and edges. Lasts through the day.',
    category: 'hair-care',
    tags: ['care'],
    options: [{ name: 'Size', values: [{ label: '60ml', key: '60ml' }, { label: '120ml', key: '120ml' }] }],
    price: (p) => (p.Size === '120ml' ? 6500 : 4000),
    stock: 40,
  },
  {
    slug: 'wig-shampoo-conditioner-set',
    title: 'Wig shampoo and conditioner set',
    description: 'Sulphate-free cleanse and a deep conditioning mask, made for human-hair units.',
    category: 'hair-care',
    collections: ['best-sellers'],
    tags: ['care', 'bestseller'],
    badge: 'Best seller',
    options: [{ name: 'Size', values: [{ label: '250ml set', key: '250ml' }, { label: '500ml set', key: '500ml' }] }],
    price: (p) => (p.Size === '500ml' ? 18500 : 11000),
    stock: 25,
  },
  {
    slug: 'satin-sleep-bonnet',
    title: 'Satin sleep bonnet',
    description: 'Double-layered satin to protect your wig and your edges overnight.',
    category: 'accessories',
    tags: ['accessory'],
    options: [colour('natural-black', 'burgundy', 'honey-blonde')],
    price: () => 3500,
    stock: 60,
  },
  {
    slug: 'elastic-wig-grip-band',
    title: 'Velvet wig grip band',
    description: 'A velvet-lined band that keeps your wig in place without glue. Doubles as a free gift on larger orders.',
    category: 'accessories',
    tags: ['accessory', 'gift'],
    options: [{ name: 'Size', values: [{ label: 'One size', key: 'one-size' }] }],
    price: () => 5000,
    stock: 100,
  },
  {
    slug: 'sold-out-curly-wig',
    title: 'Jerry curl lace wig (sold out)',
    description: 'Seed data: every variant is out of stock, to test the sold-out states and back-in-stock alerts.',
    category: 'frontal',
    tags: ['test'],
    options: [texture('jerry-curl', 'Jerry curl'), lace('13x4-frontal'), lengths([14, 18]), density(150)],
    price: lengthPrice(115000, 6000),
    stock: 0,
  },
  {
    slug: 'low-stock-pixie-wig',
    title: 'Pixie cut wig (low stock)',
    description: 'Seed data: only a couple of units left, to test the low-stock messaging and the admin low-stock filter.',
    category: 'bobs',
    tags: ['test'],
    options: [texture('straight', 'Straight'), lace('13x4-frontal'), lengths([6, 8]), density(150)],
    price: lengthPrice(55000, 4000),
    stock: 2,
    lowStockThreshold: 3,
  },
  {
    slug: 'draft-ombre-wig',
    title: 'Ombre wig (draft)',
    description: 'Seed data: an unpublished draft that only shows in the admin.',
    category: 'coloured',
    tags: ['test'],
    status: 'draft',
    options: [texture('straight', 'Straight'), lace('13x4-frontal'), lengths([18, 22])],
    price: lengthPrice(150000, 6500),
    stock: 5,
  },
];

const CUSTOMER_SEEDS = [
  { email: 'ada@example.com', phone: '+2348030000001', name: 'Ada Okafor', city: 'Lekki', state: 'Lagos' },
  { email: 'tola@example.com', phone: '+2348030000002', name: 'Tola Bakare', city: 'Ikeja', state: 'Lagos' },
  { email: 'amina@example.com', phone: '+2348030000003', name: 'Amina Yusuf', city: 'Wuse 2', state: 'FCT' },
] as const;

type SeedLogger = (message: string) => void;

export type DevSeedOptions = {
  log?: SeedLogger;
  ownerEmail?: string;
  ownerPassword?: string;
  /** Where mock images are written, for a web server to serve at MEDIA_PUBLIC_BASE_URL. Defaults to the frontend's public folder; null skips images. */
  mediaDir?: string | null;
};

/** The frontend's `public/mock-media`, which the dev server serves at http://localhost:3000/mock-media. */
export const DEFAULT_MEDIA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../frontend/public/mock-media');
export const MEDIA_ENV = { MEDIA_S3_ENDPOINT: 'http://localhost:9000', MEDIA_S3_BUCKET: 'mock', MEDIA_S3_ACCESS_KEY_ID: 'mock', MEDIA_S3_SECRET_ACCESS_KEY: 'mock', MEDIA_PUBLIC_BASE_URL: 'http://localhost:3000/mock-media' };

/** Idempotent: every piece is created only if it is missing, so a second run changes nothing and edits survive. */
export async function seedDev(db: Db, { log = () => undefined, ownerEmail = DEV_OWNER.email, ownerPassword = DEV_OWNER.password, mediaDir = DEFAULT_MEDIA_DIR }: DevSeedOptions = {}) {
  await seed(db, { ownerEmail, ownerPassword });
  const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(sql`lower(${adminUsers.email})`, ownerEmail.toLowerCase()));
  if (!owner) throw new Error(`The owner ${ownerEmail} exists with another password; seed-dev needs it to author promotions.`);

  await seedZones(db);
  log('delivery zones ready');
  const productIds = await seedProducts(db, log);
  const customerIds = await seedCustomers(db);
  log(`${customerIds.length} customers`);
  await seedOrdersAndReviews(db, customerIds, log);
  await seedPromotions(db, owner.id, productIds, log);
  await seedContent(db, productIds);
  log('storefront content ready');
  if (mediaDir) log(`${await seedMedia(db, productIds, mediaDir)} mock images written to ${mediaDir}`);
}

/** Every state and the FCT apart from the two with their own zones above. */
const NATIONWIDE_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

async function seedZones(db: Db) {
  const zones = await listZones(db);
  const lagos = zones.find((z) => z.name === 'Lagos');
  const lagosFields = {
    active: true,
    // No areas: a zone that lists areas covers only those, and the product page asks by state alone.
    areas: [] as string[],
    sameDayFeeMinor: naira(3500),
    nextDayFeeMinor: naira(2500),
    nationwideFeeMinor: null,
    pickupEnabled: true,
  };
  // An inactive Lagos zone is the pristine reference-seed one; an owner who has already switched it on keeps their own rates.
  if (lagos && !lagos.active) await upsertZones(db, [{ id: lagos.id, ...lagosFields }]);
  if (!lagos) await upsertZones(db, [{ name: 'Lagos', state: 'Lagos', sameDayCutoffLocal: '14:00', timezone: 'Africa/Lagos', ...lagosFields }]);
  if (!zones.some((z) => z.name === 'Abuja')) {
    await upsertZones(db, [{ name: 'Abuja', state: 'FCT', active: true, areas: [], nextDayFeeMinor: naira(4500), nationwideFeeMinor: null, pickupEnabled: false, timezone: 'Africa/Lagos' }]);
  }
  // Zones are per state, so nationwide delivery needs a zone for each state it reaches: every other state, so none is refused.
  for (const state of NATIONWIDE_STATES) {
    if (!zones.some((z) => z.state === state)) await upsertZones(db, [{ name: state, state, active: true, areas: [], nationwideFeeMinor: naira(6500), pickupEnabled: false, timezone: 'Africa/Lagos' }]);
  }
}

async function seedProducts(db: Db, log: SeedLogger): Promise<Record<string, { id: string; variants: Record<string, string> }>> {
  const categoryId = new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]));
  const collectionId = new Map((await db.select({ id: collections.id, slug: collections.slug }).from(collections)).map((c) => [c.slug, c.id]));
  const out: Record<string, { id: string; variants: Record<string, string> }> = {};
  let created = 0;

  for (const [index, spec] of PRODUCT_SEEDS.entries()) {
    const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.slug, spec.slug));
    let productId = existing?.id;
    if (!productId) {
      const product = await createProduct(db, {
        title: spec.title,
        slug: spec.slug,
        description: spec.description,
        featured: spec.featured ?? false,
        badgeOverride: spec.badge ?? null,
        tags: spec.tags ?? [],
        details: { fit: 'Adjustable straps and combs for a snug fit.', care: 'Wash every 10 to 12 wears with sulphate-free shampoo. Air dry.', delivery: 'Ships from Lagos within 1 to 2 working days.' },
        categoryIds: [categoryId.get(spec.category)!],
        collectionIds: (spec.collections ?? []).map((s) => collectionId.get(s)!),
      });
      productId = product.id;
      await replaceMatrix(db, null, productId, matrixOf(spec));
      if (spec.status !== 'draft') {
        // Stagger publish dates so "newest" sorting has something to sort.
        await setProductStatus(db, productId, 'active', { publishAt: new Date(Date.now() - (PRODUCT_SEEDS.length - index) * 36 * 3_600_000) });
      }
      if (spec.lowStockThreshold !== undefined) {
        const variantIds = (await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, productId))).map((v) => v.id);
        await db.update(inventory).set({ lowStockThreshold: spec.lowStockThreshold }).where(inArray(inventory.variantId, variantIds));
      }
      created++;
    }
    const variants = await db.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants).where(eq(productVariants.productId, productId));
    out[spec.slug] = { id: productId, variants: Object.fromEntries(variants.map((v) => [v.sku, v.id])) };
  }
  log(`${created} new products (${PRODUCT_SEEDS.length - created} already there)`);
  return out;
}

/** Every combination of the options, each with its own SKU, price and opening stock. */
function matrixOf(spec: ProductSpec): MatrixInput {
  const combos = spec.options.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v.key }))), [{}]);
  const prefix = spec.slug.split('-').filter((w) => w.length > 1).slice(0, 3).map((w) => w.slice(0, 3).toUpperCase()).join('');
  return {
    options: spec.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, valueKey: v.key, swatch: v.swatch ?? null })) })),
    variants: combos.map((pick) => {
      const price = naira(spec.price(pick));
      const stock = typeof spec.stock === 'function' ? spec.stock(pick) : (spec.stock ?? 0);
      return {
        sku: `${prefix}-${Object.values(pick).join('-')}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
        optionValues: pick,
        priceMinor: price,
        compareAtPriceMinor: spec.wasMultiplier ? Math.round((price * spec.wasMultiplier) / 100_000) * 100_000 : null,
        stock,
      };
    }),
  };
}

async function seedCustomers(db: Db): Promise<string[]> {
  const passwordHash = await hashPassword(DEV_CUSTOMER_PASSWORD);
  const ids: string[] = [];
  for (const c of CUSTOMER_SEEDS) {
    const [existing] = await db.select({ id: customers.id }).from(customers).where(eq(sql`lower(${customers.email})`, c.email));
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const [row] = await db.insert(customers).values({ email: c.email, phoneE164: c.phone, passwordHash, status: 'active', emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() }).returning({ id: customers.id });
    ids.push(row!.id);
  }
  return ids;
}

type OrderSeed = {
  number: string;
  customer: number;
  daysAgo: number;
  status: 'pending_payment' | 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  payment: 'pending' | 'paid' | 'failed';
  method: 'same_day' | 'next_day' | 'nationwide' | 'pickup';
  lines: { slug: string; pick: Record<string, string>; qty: number }[];
  review?: { rating: number; title: string; body: string; status: 'approved' | 'pending' };
};

const ORDER_SEEDS: OrderSeed[] = [
  { number: 'JH-DEV-1001', customer: 0, daysAgo: 21, status: 'delivered', payment: 'paid', method: 'next_day', lines: [{ slug: 'body-wave-hd-frontal-wig', pick: { Texture: 'body-wave', Lace: 'hd-frontal', Length: '22', Density: '180' }, qty: 1 }], review: { rating: 5, title: 'Worth every naira', body: 'The lace melted into my skin and the curls held up after two washes. Delivery was fast too.', status: 'approved' } },
  { number: 'JH-DEV-1002', customer: 1, daysAgo: 14, status: 'delivered', payment: 'paid', method: 'same_day', lines: [{ slug: 'classic-bob-wig', pick: { Texture: 'straight', Lace: '13x4-frontal', Length: '10', Density: '150' }, qty: 1 }, { slug: 'satin-sleep-bonnet', pick: { Colour: 'burgundy' }, qty: 2 }], review: { rating: 4, title: 'Sharp cut, great value', body: 'Sat perfectly with barely any styling. Knocked one star because the straps were a bit tight.', status: 'approved' } },
  { number: 'JH-DEV-1003', customer: 2, daysAgo: 9, status: 'delivered', payment: 'paid', method: 'nationwide', lines: [{ slug: 'kinky-curly-glueless-wig', pick: { Texture: 'kinky-curly', Lace: 'transparent', Length: '16', Density: '150' }, qty: 1 }], review: { rating: 5, title: 'Truly glueless', body: 'Put it on in minutes and it stayed all day.', status: 'pending' } },
  { number: 'JH-DEV-1004', customer: 0, daysAgo: 3, status: 'out_for_delivery', payment: 'paid', method: 'same_day', lines: [{ slug: 'wig-shampoo-conditioner-set', pick: { Size: '250ml' }, qty: 1 }, { slug: 'edge-control-gel', pick: { Size: '60ml' }, qty: 2 }] },
  { number: 'JH-DEV-1005', customer: 1, daysAgo: 1, status: 'placed', payment: 'paid', method: 'next_day', lines: [{ slug: 'straight-13x4-frontal-wig', pick: { Texture: 'straight', Lace: '13x4-frontal', Length: '20', Density: '150' }, qty: 1 }] },
  { number: 'JH-DEV-1006', customer: 2, daysAgo: 0, status: 'pending_payment', payment: 'pending', method: 'next_day', lines: [{ slug: 'colour-pop-straight-wig', pick: { Texture: 'straight', Lace: '13x4-frontal', Length: '20', Colour: 'burgundy', Density: '150' }, qty: 1 }] },
  { number: 'JH-DEV-1007', customer: 0, daysAgo: 30, status: 'cancelled', payment: 'failed', method: 'pickup', lines: [{ slug: 'deep-wave-5x5-closure-wig', pick: { Texture: 'deep-wave', Lace: '5x5-closure', Length: '18', Density: '150' }, qty: 1 }] },
];

async function seedOrdersAndReviews(db: Db, customerIds: string[], log: SeedLogger) {
  const existing = new Set((await db.select({ n: orders.orderNumber }).from(orders).where(inArray(orders.orderNumber, ORDER_SEEDS.map((o) => o.number)))).map((o) => o.n));
  let created = 0;

  for (const o of ORDER_SEEDS) {
    if (existing.has(o.number)) continue;
    const customer = CUSTOMER_SEEDS[o.customer]!;
    const lines: { product: { id: string; title: string }; variant: { id: string; sku: string; sig: unknown; price: number }; l: OrderSeed['lines'][number] }[] = [];
    for (const l of o.lines) {
      const [product] = await db.select({ id: products.id, title: products.title }).from(products).where(eq(products.slug, l.slug));
      const variants = await db.select({ id: productVariants.id, sku: productVariants.sku, sig: productVariants.optionSignature, price: productVariants.priceMinor }).from(productVariants).where(eq(productVariants.productId, product!.id));
      const variant = variants.find((v) => JSON.stringify(Object.entries(v.sig as object).sort()) === JSON.stringify(Object.entries(l.pick).sort()));
      if (!variant) throw new Error(`Seed order ${o.number}: no variant of ${l.slug} matches ${JSON.stringify(l.pick)}`);
      lines.push({ product: product!, variant, l });
    }
    const subtotal = lines.reduce((s, x) => s + x.variant.price * x.l.qty, 0);
    const fee = { same_day: naira(3500), next_day: naira(2500), nationwide: naira(6500), pickup: 0 }[o.method];
    const when = new Date(Date.now() - o.daysAgo * 86_400_000);
    const paid = o.payment === 'paid';

    await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber: o.number,
          customerId: customerIds[o.customer]!,
          status: o.status,
          paymentStatus: o.payment,
          email: customer.email,
          phoneE164: customer.phone,
          subtotalMinor: subtotal,
          deliveryFeeMinor: fee,
          totalMinor: subtotal + fee,
          deliveryAddressSnapshot: { recipientName: customer.name, phoneE164: customer.phone, line1: '12 Admiralty Way', city: customer.city, state: customer.state, country: 'NG' },
          deliveryMethod: o.method,
          termsAcceptedAt: when,
          reservationExpiresAt: o.status === 'pending_payment' ? new Date(Date.now() + 30 * 60_000) : null,
          placedAt: paid ? when : null,
          createdAt: when,
        })
        .returning({ id: orders.id });
      for (const x of lines) {
        const [item] = await tx
          .insert(orderItems)
          .values({ orderId: order!.id, productId: x.product.id, variantId: x.variant.id, skuSnapshot: x.variant.sku, titleSnapshot: x.product.title, optionsSnapshot: x.variant.sig as object, quantity: x.l.qty, unitPriceMinor: x.variant.price, lineTotalMinor: x.variant.price * x.l.qty })
          .returning({ id: orderItems.id });
        if (o.review && x === lines[0]) {
          await tx.insert(reviews).values({ productId: x.product.id, customerId: customerIds[o.customer]!, orderItemId: item!.id, rating: o.review.rating, title: o.review.title, body: o.review.body, location: customer.city, status: o.review.status, verifiedBuyer: true, moderatedAt: o.review.status === 'approved' ? when : null });
        }
      }
    });
    created++;
  }
  log(`${created} new orders (${ORDER_SEEDS.length - created} already there)`);
}

async function seedPromotions(db: Db, adminId: string, ids: Record<string, { id: string; variants: Record<string, string> }>, log: SeedLogger) {
  const grip = Object.values(ids['elastic-wig-grip-band']!.variants)[0]!;
  const day = 86_400_000;
  const specs: Parameters<typeof createPromotion>[2][] = [
    { name: 'Welcome 10% off', kind: 'percentage', configuration: { version: 1, percent: 10 }, firstOrderOnly: true, codes: [{ code: 'WELCOME10' }] },
    { name: 'Flash sale: 20% off wigs', kind: 'percentage', configuration: { version: 1, percent: 20, maxDiscountMinor: naira(40000) }, startsAt: new Date(Date.now() - day), endsAt: new Date(Date.now() + 5 * day), codes: [{ code: 'FLASH20' }] },
    { name: 'Free delivery over ₦150,000', kind: 'free_delivery', configuration: { version: 1 }, minimumSubtotalMinor: naira(150000), codes: [{ code: 'FREESHIP' }] },
    { name: '₦5,000 off', kind: 'fixed_amount', configuration: { version: 1, amountMinor: naira(5000) }, minimumSubtotalMinor: naira(50000), codes: [{ code: 'SAVE5K' }] },
    { name: 'Free grip band over ₦300,000', kind: 'free_gift', configuration: { version: 1, variantId: grip, quantity: 1 }, minimumSubtotalMinor: naira(300000) },
    { name: 'Expired Black Friday (ended)', kind: 'percentage', configuration: { version: 1, percent: 30 }, startsAt: new Date(Date.now() - 60 * day), endsAt: new Date(Date.now() - 30 * day), codes: [{ code: 'BLACKFRI30' }] },
  ];
  let created = 0;
  for (const spec of specs) {
    const code = spec.codes?.[0]?.code;
    const found = code
      ? await db.select({ id: promotionCodes.id }).from(promotionCodes).where(eq(sql`upper(${promotionCodes.code})`, code))
      : await db.execute(sql`select id from promotions where name = ${spec.name}`);
    if (found.length) continue;
    const promo = await createPromotion(db, adminId, spec);
    // An ended promotion cannot be armed; it stays as the history the admin list should show.
    if (!spec.endsAt || spec.endsAt > new Date()) await setPromotionState(db, promo.id, 'active');
    created++;
  }
  log(`${created} new promotions`);
}

async function seedContent(db: Db, ids: Record<string, { id: string; variants: Record<string, string> }>) {
  const entry = async (contentType: string, slug: string, title: string, body: Record<string, unknown>, sortOrder = 0, endsAt: Date | null = null) => {
    await db.insert(contentEntries).values({ contentType, slug, title, body, status: 'published', sortOrder, endsAt }).onConflictDoNothing();
  };

  await entry('announcement', 'dev-free-delivery', 'Free delivery', { text: 'Free delivery on orders over ₦150,000. Use code FREESHIP.', linkUrl: '/shop', linkLabel: 'Shop now' });
  await entry('banner', 'dev-hero-frontals', 'Frontals hero', { tag: 'New in', headline: 'Frontals, ready to wear', subheadline: 'Pre-plucked, bleached knots, baby hairs done.', tone: 'pink', ctaLabel: 'Shop frontals', ctaUrl: '/shop/frontal' }, 0);
  await entry('banner', 'dev-hero-glueless', 'Glueless hero', { tag: 'Best seller', headline: 'Glueless in five minutes', subheadline: 'No glue, no fuss.', tone: 'plum', ctaLabel: 'Shop glueless', ctaUrl: '/shop/glueless' }, 1);
  for (const [i, [slug, title, link, highlight]] of ([['frontal', 'Frontals', '/shop/frontal', true], ['glueless', 'Glueless', '/shop/glueless', true], ['bobs', 'Bobs', '/shop/bobs', false], ['coloured', 'Coloured', '/shop/coloured', false], ['hair-care', 'Care', '/shop/hair-care', false]] as const).entries()) {
    await entry('story', `dev-story-${slug}`, title, { title, linkUrl: link, highlight }, i);
  }
  await entry('tile', 'dev-tile-bobs', 'Bobs', { title: 'Bobs', subtitle: 'Light and sharp', tone: 'pink', linkUrl: '/shop/bobs' }, 0);
  await entry('tile', 'dev-tile-coloured', 'Coloured', { title: 'Coloured', subtitle: 'Blonde, burgundy, ginger', tone: 'blush', linkUrl: '/shop/coloured' }, 1);
  await entry('tile', 'dev-tile-care', 'Care', { title: 'Hair care', subtitle: 'Keep it fresh', tone: 'plum', linkUrl: '/shop/hair-care' }, 2);

  const picks = ['body-wave-hd-frontal-wig', 'straight-13x4-frontal-wig', 'kinky-curly-glueless-wig', 'classic-bob-wig', 'honey-blonde-613-frontal-wig'].flatMap((s) => ids[s]?.id ?? []);
  await entry('featured_products', 'dev-picks', "Jetty's picks", { heading: "Jetty's picks", productIds: picks });

  // The flash strip counts down to a live promotion's end.
  const [flash] = await db.execute<{ id: string }>(sql`select p.id from promotions p join promotion_codes c on c.promotion_id = p.id where upper(c.code) = 'FLASH20'`);
  if (flash) await entry('flash', 'dev-flash', 'Flash sale', { promotionId: flash.id, headline: 'Flash sale: 20% off wigs' });
}

/** What a product looks like in its mock photos, from its texture, length range and colours. */
function lookOf(spec: ProductSpec, index: number): MockSpec {
  const texture = spec.options.find((o) => o.name === 'Texture')?.values[0]?.key ?? '';
  const kind: MockKind = spec.category === 'hair-care' ? 'care' : spec.category === 'accessories' ? 'accessory' : spec.category === 'bobs' ? 'bob' : texture.includes('curl') ? 'curly' : texture.includes('wave') ? 'wave' : 'straight';
  const swatches = spec.options.find((o) => o.name === 'Colour')?.values.filter((v) => v.swatch) ?? [];
  const lens = (spec.options.find((o) => o.name === 'Length')?.values ?? []).map((v) => Number(v.key));
  const mid = lens.length ? lens[Math.floor(lens.length / 2)]! : 16;
  const careColours = ['#c0386a', '#6d1a36', '#7a3b8f', '#2f7f77'];
  return {
    kind,
    hair: kind === 'care' ? careColours[index % careColours.length]! : (swatches[Math.min(1, swatches.length - 1)]?.swatch ?? '#1b1b1b'),
    length: Math.min(Math.max((mid - 6) / 24, 0), 1),
    tone: index,
    seed: 1000 + index * 17,
  };
}

/**
 * Writes the mock images for every product and registers them as its media (cover first), plus images for the home
 * content. Run the API with MEDIA_ENV so these keys resolve to URLs. Safe to repeat: existing media is left alone.
 */
async function seedMedia(db: Db, ids: Record<string, { id: string; variants: Record<string, string> }>, dir: string): Promise<number> {
  const write = async (key: string, svg: string) => {
    const file = join(dir, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, svg);
  };
  let written = 0;
  for (const [index, spec] of PRODUCT_SEEDS.entries()) {
    const product = ids[spec.slug];
    if (!product) continue;
    const look = lookOf(spec, index);
    const rows = MOCK_ANGLES.map((angle, sortOrder) => ({ productId: product.id, objectKey: `products/${spec.slug}/${angle}.svg`, altText: `${spec.title}, ${angle === 'detail' ? 'close-up' : `${angle} view`}`, angle, sortOrder, isCover: sortOrder === 0, width: MOCK_SIZE.width, height: MOCK_SIZE.height }));
    for (const row of rows) {
      await write(row.objectKey, mockSvg(look, row.angle));
      written++;
    }
    const [has] = await db.select({ id: productMedia.id }).from(productMedia).where(eq(productMedia.productId, product.id)).limit(1);
    if (!has) await db.insert(productMedia).values(rows);
  }

  const content: [type: string, slug: string, kind: MockKind, hair: string, alt: string][] = [
    ['banner', 'dev-hero-frontals', 'wave', '#1b1b1b', 'A body wave frontal wig'],
    ['banner', 'dev-hero-glueless', 'curly', '#6d1a36', 'A kinky curly glueless wig'],
    ['story', 'dev-story-frontal', 'wave', '#1b1b1b', 'Frontal wigs'],
    ['story', 'dev-story-glueless', 'curly', '#1b1b1b', 'Glueless wigs'],
    ['story', 'dev-story-bobs', 'bob', '#1b1b1b', 'Bob wigs'],
    ['story', 'dev-story-coloured', 'straight', '#c9a25a', 'Coloured wigs'],
    ['story', 'dev-story-hair-care', 'straight', '#6d1a36', 'Hair care'],
    ['tile', 'dev-tile-bobs', 'bob', '#1b1b1b', 'A blunt bob wig'],
    ['tile', 'dev-tile-coloured', 'straight', '#b5651d', 'A ginger wig'],
    ['tile', 'dev-tile-care', 'straight', '#6d1a36', 'Hair care products'],
  ];
  for (const [i, [type, slug, kind, hair, alt]] of content.entries()) {
    const key = `content/${slug}.svg`;
    // Tiles are wide and cropped, so they get a full-bleed hair texture; the rest are portraits.
    const look = { kind, hair, length: 0.5, tone: i, seed: 5000 + i };
    await write(key, type === 'tile' ? mockTextureSvg(look) : mockBannerSvg(look));
    written++;
    await db.execute(sql`update content_entries set body = body || jsonb_build_object('imageObjectKey', ${key}::text, 'imageAlt', ${alt}::text) where content_type = ${type} and slug = ${slug} and not (body ? 'imageObjectKey')`);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required to seed');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to load development seed data with NODE_ENV=production');
    process.exit(1);
  }
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await seedDev(db, { log: (m) => console.log(`  ${m}`), mediaDir: process.env.MOCK_MEDIA_DIR === 'none' ? null : (process.env.MOCK_MEDIA_DIR ?? DEFAULT_MEDIA_DIR) });
    console.log(`
Development data ready.
  Admin     ${DEV_OWNER.email} / ${DEV_OWNER.password}   (http://localhost:3000/admin)
  Customers ada@example.com, tola@example.com, amina@example.com / ${DEV_CUSTOMER_PASSWORD}
  Promo codes  WELCOME10, FLASH20, FREESHIP, SAVE5K (BLACKFRI30 has ended)

Mock images were written (see above). To have the API serve them, add this to api/.env and restart it:
${Object.entries(MEDIA_ENV).map(([k, v]) => `  ${k}=${v}`).join('\n')}`);
  } finally {
    await close();
  }
}
