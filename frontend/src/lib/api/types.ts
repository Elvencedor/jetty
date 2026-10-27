/**
 * Response and request shapes of the hapi API, as implemented (see docs/API.md). Amounts are integer minor units
 * (kobo); timestamps are UTC ISO strings. Admin types arrive with the admin phases.
 */

export type Money = { amountMinor: number; currency: string };
export type Page = { nextCursor: string | null; /** Matching items across all pages; only on the first page of listings. */ total?: number | null };
export type Paged<T> = { data: T[]; page: Page };

/** An image reference. `url` is a CDN (or presigned) URL, null when media storage is not configured. */
export type ImageRef = { objectKey: string; url: string | null; altText: string | null; width: number | null; height: number | null };

// ------------------------------------------------------------------ catalog

export type Badge = { kind: "sale" | "new" | "low_stock" | "featured" | "custom"; label: string };
export type ColourOption = { label: string; valueKey: string; swatch: string | null };

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  badge: string | null;
  badges: Badge[];
  colours: ColourOption[];
  lengthRange: { min: number; max: number } | null;
  featured: boolean;
  price: { minAmountMinor: number; maxAmountMinor: number; /** The struck-through "was" price of the cheapest variant, when it is on sale. */ compareAtMinor: number | null; currency: string };
  inStock: boolean;
  onOffer: boolean;
  rating: { average: number; count: number };
  image: ImageRef | null;
};

export type FacetValue = { valueKey: string; label: string; swatch: string | null; count: number };
export const FACET_OPTIONS = ["texture", "lace", "length", "density", "colour"] as const;
export type FacetOption = (typeof FACET_OPTIONS)[number];
export type Facets = {
  options: Record<FacetOption, FacetValue[]>;
  price: { minMinor: number; maxMinor: number } | null;
  inStockCount: number;
  onOfferCount: number;
};

export type ProductSort = "recommended" | "bestSelling" | "newest" | "priceAsc" | "priceDesc" | "topRated";

export type OptionValue = { id: string; label: string; valueKey: string; swatch: string | null };
export type ProductOption = { id: string; name: string; values: OptionValue[] };
export type Availability = { inStock: boolean; availableQuantity: number; lowStock: boolean };
export type Variant = { id: string; sku: string; price: Money; compareAtPrice: Money | null; optionValueIds: string[]; availability: Availability };
export type ProductMedia = {
  id: string;
  variantId: string | null;
  objectKey: string;
  url: string | null;
  altText: string | null;
  mediaType: string;
  angle: string | null;
  isCover: boolean;
  width: number | null;
  height: number | null;
};

export type ProductDetails = { details: string | null; fit: string | null; care: string | null; delivery: string | null };

export type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  badge: string | null;
  featured: boolean;
  seo: { title: string | null; description: string | null };
  details: ProductDetails;
  /** Best-selling variant that can be bought now: preselect it so the price shows immediately. */
  defaultVariantId: string | null;
  soldCount: number;
  publishedAt: string | null;
  categories: { slug: string; name: string }[];
  collections: { slug: string; name: string }[];
  options: ProductOption[];
  variants: Variant[];
  media: ProductMedia[];
  rating: { average: number; count: number };
};

export type CategoryNode = { id: string; slug: string; name: string; children: CategoryNode[] };
export type CategoryTree = { categories: CategoryNode[]; collections: { id: string; slug: string; name: string; description: string | null }[] };

export type Suggestion = { id: string; slug: string; title: string; image: ImageRef | null };

export type Review = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  location: string | null;
  verifiedBuyer: boolean;
  variant: Record<string, unknown> | null;
  createdAt: string;
};
export type ReviewList = {
  summary: { average: number; count: number; breakdown: Record<"1" | "2" | "3" | "4" | "5", number> };
  data: Review[];
  page: Page;
};
export type ReviewSort = "newest" | "highest" | "lowest";

// ------------------------------------------------------------------ content

export type Announcement = { id: string; text: string; linkUrl?: string; linkLabel?: string };
export type Tone = "pink" | "blush" | "plum" | "white";

export type HomeSection =
  | { type: "stories"; items: { id: string; title: string; imageObjectKey?: string; imageUrl?: string; imageAlt?: string; linkUrl: string; highlight?: boolean }[] }
  | {
      type: "hero";
      cards: { id: string; tag?: string; headline: string; subheadline?: string; tone?: Tone; imageObjectKey?: string; imageUrl?: string; imageAlt?: string; ctaLabel?: string; ctaUrl?: string; endsAt: string | null }[];
    }
  | { type: "flash"; promotionId: string; headline: string; code: string | null; endsAt: string }
  | { type: "products"; title: string; tabs: { key: "featured" | "deal" | "care"; label: string; products: ProductCard[] }[] }
  | { type: "length"; title: string; items: { label: string; hint: string; lengths: number[] }[] }
  | { type: "tiles"; items: { id: string; title: string; subtitle?: string; tone?: Tone; imageObjectKey?: string; imageUrl?: string; imageAlt?: string; linkUrl: string }[] }
  | { type: "trust"; items: { icon: string; title: string; caption: string }[] };

export type HomeContent = { announcements: Announcement[]; sections: HomeSection[] };

export type StoreSettings = {
  store: { name: string; contactEmail: string; contactPhone: string; whatsappNumber: string; showroomAddress: string; showroomHours: string };
  policies: { returnWindowDays: number; podMaxOrderMinor: number | null };
  payments: { enabledMethods: PaymentMethod[]; cardHoldMinutes: number; transferHoldMinutes: number };
};

export type StaticPage = { slug: string; title: string; markdown: string; updatedAt: string };

// ------------------------------------------------------------- pricing & checkout

export type DeliveryMethod = "same_day" | "next_day" | "nationwide" | "pickup";
export type PaymentMethod = "card" | "bank_transfer";
export type DeliveryEstimate = { earliestDate: string; latestDate: string };

export type QuoteLine = {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  image: ImageRef | null;
  options: { name: string; label: string }[];
  optionSummary: string;
  compareAtPriceMinor: number | null;
  availableQuantity: number;
  quantity: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
  promotionAllocations: { promotionId: string; amountMinor: number }[];
  /** Set on a line the shopper did not add: a free gift from this promotion. It cannot be edited or removed. */
  gift?: { promotionId: string } | null;
};

export type AppliedPromotion = { promotionId: string; name: string; kind: string; code: string | null; discountMinor: number };
export type RejectedCode = { code: string; reason: "INVALID_CODE" | "EXPIRED" | "USAGE_LIMIT_REACHED" | "NOT_ELIGIBLE" | "MIN_SPEND_NOT_MET" | "NOT_APPLICABLE" };
export type QuoteWarning =
  | { code: "OUT_OF_STOCK" | "INSUFFICIENT_STOCK"; variantId: string; requestedQuantity: number; availableQuantity: number }
  | { code: "GIFT_UNAVAILABLE"; promotionId: string; variantId: string }
  | { code: "SIGN_IN_FOR_OFFERS" };

export type Quote = {
  currency: string;
  lines: QuoteLine[];
  promotions: { applied: AppliedPromotion[]; rejectedCodes: RejectedCode[] };
  warnings: QuoteWarning[];
  subtotalMinor: number;
  discountMinor: number;
  delivery: { method: DeliveryMethod; zoneId: string; zoneName: string; baseFeeMinor: number; feeMinor: number; freeDeliveryPromotionId: string | null; estimate: DeliveryEstimate | null } | null;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  quoteId: string;
  quoteExpiresAt: string;
};

export type DeliveryOption = {
  method: DeliveryMethod;
  available: boolean;
  reason?: "CUTOFF_PASSED";
  baseFeeMinor: number;
  feeMinor: number;
  freeDeliveryPromotionId: string | null;
  estimate: DeliveryEstimate | null;
};
export type DeliveryQuote = { currency: string; zone: { id: string; name: string; state: string }; options: DeliveryOption[]; warnings: QuoteWarning[] };

export type CartItemInput = { variantId: string; quantity: number };

export type CheckoutRequest = {
  items: CartItemInput[];
  promotionCodes: string[];
  contact: { phone: string; email?: string };
  deliveryAddress: { recipientName: string; addressLine1: string; addressLine2?: string; area?: string; city: string; state: string; countryCode: "NG"; landmark?: string; riderNote?: string };
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
  termsAccepted: true;
};

export type PaymentStart = {
  orderId: string;
  orderNumber: string;
  paymentAttemptId: string;
  provider: string;
  reference: string;
  accessCode: string;
  authorizationUrl: string;
  amountMinor: number;
  currency: string;
  reservationExpiresAt: string;
};
export type CheckoutResponse = PaymentStart & { quote: Pick<Quote, "lines" | "promotions" | "subtotalMinor" | "discountMinor" | "deliveryFeeMinor" | "taxMinor" | "totalMinor"> };

export type OrderStatusValue = "pending_payment" | "placed" | "packed" | "out_for_delivery" | "delivered" | "cancelled" | "refunded" | "payment_exception";
export type PaymentStatusValue = "pending" | "paid" | "failed" | "refunded";

/** Minimal status for polling; never contains contact details or the address. */
export type CheckoutStatus = {
  orderId: string;
  orderNumber: string;
  status: OrderStatusValue;
  paymentStatus: PaymentStatusValue;
  amountMinor: number;
  currency: string;
  reservationExpiresAt: string | null;
  deliveryMethod: DeliveryMethod;
  estimate: DeliveryEstimate | null;
  itemCount: number;
  recipientFirstName: string | null;
  paymentAttempt: { id: string; status: "initializing" | "pending" | "succeeded" | "failed" | "expired" | "refunded" } | null;
};

export type TimelineEntry = { status: OrderStatusValue; at: string };
export type TrackResult = { orderNumber: string; status: OrderStatusValue; paymentStatus: PaymentStatusValue; deliveryMethod: DeliveryMethod; placedAt: string | null; timeline: TimelineEntry[] };

// ------------------------------------------------------------------ accounts

export type Customer = { id: string; phone: string | null; email: string | null; emailVerified: boolean; phoneVerified: boolean; createdAt: string };
export type SessionResponse = { accessToken: string; tokenType: "Bearer"; expiresIn: number; customer: Customer };
export type CodeSent = { expiresInSeconds: number; resendAfterSeconds: number };

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: OrderStatusValue;
  paymentStatus: PaymentStatusValue;
  currency: string;
  totalMinor: number;
  itemCount: number;
  placedAt: string | null;
  createdAt: string;
};

export type OrderItem = {
  id: string;
  slug: string | null;
  image: ImageRef | null;
  /** True once the order is delivered and the customer has not reviewed this line yet. */
  reviewable: boolean;
  productId: string | null;
  variantId: string | null;
  sku: string;
  title: string;
  options: Record<string, string>;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
};

export type OrderDetail = OrderSummary & {
  contact: { phone: string; email: string | null };
  deliveryMethod: DeliveryMethod;
  deliveryAddress: { recipientName?: string; addressLine1?: string; addressLine2?: string; area?: string; city?: string; state?: string; landmark?: string; zoneName?: string };
  estimate: DeliveryEstimate | null;
  rider: { name: string | null; phone: string | null; carrier: string | null; trackingReference: string | null } | null;
  items: OrderItem[];
  totals: { subtotalMinor: number; discountMinor: number; deliveryFeeMinor: number; taxMinor: number; totalMinor: number };
  promotions: { code: string | null; discountMinor: number }[];
  reservationExpiresAt: string | null;
  timeline: TimelineEntry[];
};

// -------------------------------------------------------------------- admin

export type AdminIdentity = { id: string; email: string; roles: string[]; permissions: string[] };
export type AdminSessionResponse = { accessToken: string; tokenType: "Bearer"; expiresIn: number; admin: AdminIdentity };

// ------------------------------------------------------------------ analytics

export const ANALYTICS_EVENTS = ["session_start", "product_view", "add_to_bag", "checkout_start"] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsProperties = { productId?: string; variantId?: string; quantity?: number; source?: string };

/** Error codes the UI branches on. The API sends more; anything not listed is shown with its message. */
export const KNOWN_ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "INVALID_CODE",
  "INVALID_REFRESH_TOKEN",
  "ACCOUNT_EXISTS",
  "RATE_LIMITED",
  "OUT_OF_STOCK",
  "VARIANT_UNAVAILABLE",
  "PROMOTION_UNAVAILABLE",
  "DELIVERY_UNAVAILABLE",
  "DELIVERY_METHOD_UNAVAILABLE",
  "PAYMENT_METHOD_UNAVAILABLE",
  "PAYMENT_INITIALIZATION_FAILED",
  "PAYMENT_INITIALIZATION_PENDING",
  "PAYMENT_ATTEMPT_ACTIVE",
  "ORDER_NOT_PAYABLE",
  "ORDER_ALREADY_PAID",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "REVIEW_EXISTS",
  "REVIEW_NOT_ELIGIBLE",
  "PRECONDITION_FAILED",
  "PRECONDITION_REQUIRED",
  "NOT_FOUND",
  "FORBIDDEN",
  "NETWORK_ERROR",
  "REQUEST_FAILED",
] as const;
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];
