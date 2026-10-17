# 02 · Components

The shared component inventory, derived from all 15 Option B artboards. Build these first, in `src/components/ui/` (primitives) and `src/components/commerce/` / `src/components/admin/` (composites). Each entry lists variants, props, states and the screens that use it.

State vocabulary used below: **default · hover · pressed · focus · selected · disabled · loading · error**. Unless noted, hover darkens the fill one step (`primary` → `pink-700`, `surface-inverse` → `plum-800`, white → `surface-tint`), pressed scales to 0.98, focus shows the 2px `primary` ring, and disabled uses 50% opacity with `cursor: not-allowed`.

---

## Primitives

### Button
| Variant | Fill / text | Use |
|---|---|---|
| `primary` | `primary` / white | One per view: Add to bag, Checkout, Pay, Save, Publish |
| `dark` | `surface-inverse` / white | Secondary strong action: Apply (coupon), Create account, Done |
| `outline` | white / `ink`, 2px `ink` border (1.5px `line-strong` in admin) | Back, Show more, Reset, Export |
| `soft` | `surface-tint` / `primary-strong` | Tertiary in-card actions: Edit (checkout review) |
| `danger-soft` | `danger-bg` / `danger` | Remove, Cancel order, Disable account |
| `add` | transparent / `primary-strong`, 1.5px dashed `line-accent` | "+ Add value", "+ Add a section", "+ Add zone" |
| `ghost-link` | transparent / underlined | Clear all, Keep it, Bulk edit |

Sizes (all `rounded-pill`): `sm` 34–36px h, 12px x-pad, `text-label`; `md` 40–44px, 16px x-pad; `lg` 50–56px, 22px x-pad, `text-body-lg` 700. Props: `variant, size, iconLeft?, iconRight?, loading?, fullWidth?, asChild?` (renders `<a>` for navigation). Loading replaces the label with a spinner, keeps the width and sets `aria-busy`.

### IconButton
44×44 circle, `aria-label` required. Variants: `on-white` (fill `surface-tint`), `on-tint` (fill white), `on-image` (white, sits on photos), `inverse` (white 18% on pink). Optional `badge` count: an 18px `primary` circle with a 2px white ring, top-right, `text-micro` 700. Used for the bag icon.

### Chip
| Variant | Default | Selected | Used for |
|---|---|---|---|
| `choice` | white, 1.5px `line-strong` | fill `primary`, white text | Variant options (length, lace…), filters in sheet, delivery zones |
| `choice-soft` | white, `line-strong` | `surface-tint` fill, `primary` border, `primary-strong` text | Dropdown filter pills (PLP), multi-select filters |
| `removable` | `surface-tint`, × icon | — | Active filters |
| `static` | `surface-tint`, no border | — | Option values in admin, review attribute stats |

Height 36–44px (44 when it's the main control on a mobile screen). Sold-out choice chips are `disabled`: text `faint`, struck through, `line` border, plus `aria-label="20 inches, sold out"`. A `note` prop adds a second line ("+₦25k", "Included").

### SegmentedControl / PillTabs
A `surface-tint` track (`rounded-pill`, 4px padding) holding pill buttons. Selected item: white fill with `ink` text (storefront tabs, admin drawer tabs) **or** `primary` fill with white text (range pickers, status filters, view toggle). Keep one style per screen. Use `role="tablist"` when it swaps content and `role="group"` + `aria-pressed` when it filters.

### Switch
44×26 track, 20px white knob. On: `primary` fill. Off: `line-strong` fill. Always `role="switch" aria-checked` with an accessible name. The knob slides in 120ms.

### Input, Select, Textarea
Label above (`text-label` 600), field 52px h on storefront / 44–46px in admin, `rounded-md`, 1.5px `line-strong` border, `text-body` 400. Focus: border `primary` plus ring. Error: border `danger`, message below in `text-caption` `danger` with `role="alert"`, and `aria-invalid`/`aria-describedby` set. Helper text below in `muted`. Variants: `search` (pill, `surface-tint`, leading search icon, no border) and `prefixed` (₦ or ± prefix inside the field).

### Checkbox / Radio
Native inputs, 18–20px, `accent-color: primary`. Large "radio cards" (delivery speed, payment method, promotion type, product source) are `<button role="radio" aria-checked>` inside a `role="radiogroup"`. Selected card: 2px `primary` border with `surface-tint` fill.

### Badge
`text-micro` 700, `rounded-xs`, 2–4px × 8–10px padding.
| Kind | Colours | Text |
|---|---|---|
| sale | `primary` / white | "−14%" |
| bogo | `surface-inverse` / white | "Buy 1 Get 1" |
| new, featured, low-stock (storefront) | white / `primary-strong` | "New", "Featured", "Low stock" |
| gift | `surface-inverse` / white | "FREE GIFT" |
| free-line | `primary` / white | "FREE · Buy 1 Get 1" |
| eligible | `surface-tint` / `primary-strong` | "Add 1 more bob → 1 free" |

Badges on products are **computed from live promotions and stock** (see CMS-07 in docs/FEATURES.md), not typed in by staff.

### StatusPill
`rounded-pill`, `text-caption` 700. Maps order/product/review statuses to semantic pairs:
`Awaiting payment` warning · `Paid · to pack` primary (white text) · `Packed` blush/`primary-strong` · `Out for delivery` info · `Delivered` success · `Return requested` danger · `Active` success · `Draft`/`Hidden` neutral · `Out of stock` danger · `Scheduled` info · `Live` primary.

### Swatch
A circle (14px in cards, 40–44px in pickers) with a 2px white inner ring. Selected: 3px `primary` outer ring. Always paired with a visible label or `aria-label` (colour name, not hex).

### RatingStars
Display: ★ glyphs in `primary` (storefront) with the numeric value next to them. Input (checkout rating): 5 × 44px radio buttons with `aria-label="4 stars"`.

### QuantityStepper
`surface-tint` pill with − value + buttons (40–44px each). Min 1, max 5 per line (business rule; confirm). Decrementing at 1 does nothing. Removing an item is a separate trash icon button.

### ProgressBar
5–14px tall, `rounded-pill`, track `plum-50`/`plum-800` (on dark), fill `primary`. Used by the deal tracker, stock meters, funnel and review breakdown. Animate the width change over 200ms.

### Media / ImagePlaceholder
`next/image` with `rounded-lg`, `object-cover`, explicit aspect ratio. Until photography exists it renders the photo tone with an optional caption ("Front · hi-res photo") in `primary-deep`.

---

## Commerce composites

### ProductCard
Props: `product` (name, slug, priceMinor, compareAtMinor?, rating, reviewCount, colours[], lengthRange, badges[]), `layout: "grid" | "list" | "pick"`, `wishlisted`, `onToggleWishlist`.
- **grid** (shop): media 1:1.25 `rounded-lg`; badge top-left; heart IconButton top-right (44px target, 30px visual); colour dots bottom-left; name `text-body-sm` 600, 2-line clamp; price row: price (display 800 16), struck "was", rating right-aligned.
- **pick** (home): same in a `surface-subtle` container with 8px padding and `rounded-card`, plus a 40px `primary` "+" button that opens the PDP (not a blind add, because wigs need variant choices).
- **list** (shop list view): 96×116 media left; badge, name, "★ 4.9 · 14–30"" meta; price and "+" bottom row.
- States: loading → skeleton (media block plus 2 text bars); out of stock → "Sold out" badge with the price kept.
- The whole card is one link to the PDP (an overlay `<a>`); the heart button sits above it with `z-index`.

### PriceSummary (OrderSummary)
Lines: Items, each discount (success colour, "−₦X"), gift, Delivery ("Free" or ₦), Total (display 800), plus a "You're saving ₦X" success banner. **Values always come from `POST /pricing/quote`**; the client never computes discounts. While re-quoting: dim the numbers to 50% and set `aria-busy`. Variants: `bag` (in a card), `checkout-collapsible` (header row "Show order summary · ₦X" that expands), `review` (final step).

### DealTracker
Dark card (`surface-inverse`) with an overline "YOUR DEALS" and up to 3 rows. Each row: 28px status dot (`primary` with check when unlocked, `plum-800` with + when not), message, ProgressBar. Driven by `quote.promotions[].progress` from the API. Messages: "Buy 1 Get 1 on bobs unlocked" / "Add 1 more bob to get 1 free"; "Free same-day delivery unlocked" / "Add ₦X for free delivery"; "Free silk bonnet added".

### CouponTicket
Ticket shape: 84px side panel ("15% OFF") separated by a dashed `line-accent` rule, then code and description, then an Apply/Applied button. Applied state: `primary` border, `primary` side panel, button becomes `soft` "Applied" (tapping removes it). Free-text entry sits below: pill input plus `dark` Apply. Errors appear inline: "That code isn't valid or has expired."

### BottomTabBar (storefront, mobile)
Floating `surface-inverse` pill: 12px from the screen edges, 64px tall, `bottom: calc(12px + env(safe-area-inset-bottom))`. Five items: Home, Shop, Saved, Bag, Me. The active item becomes a `primary` pill with icon and label; inactive items are icon-only in `#F4C6D8` with `aria-label`. Hidden at ≥ 1024px. Pages reserve 84px of bottom padding so content isn't hidden.

### StickyActionBar
Fixed to the bottom of mobile screens (PDP add-to-bag, bag checkout, checkout steps). White with a top `line` border, or a floating `surface-inverse` pill (bag). Holds 1 primary action, optionally a quantity stepper, a Back button or a total. Uses the safe-area inset.

### StepIndicator (checkout)
A `surface-tint` pill track with 3 equal segments: Delivery · Payment · Review. Current: `primary` fill, white label, number badge white/`primary`. Done: `ink` text with a ✓ badge on `ink`. Upcoming: `muted`. Set `aria-current="step"` on the current one. Done steps are tappable to go back.

### OrderTracker
Horizontal (customer): 5 nodes (Placed, Paid, Packed, On the way, Delivered), 32px circles joined by a 3px line, filled `primary` up to the current step, current label 800. Vertical/compact bars (admin order drawer): 4 segments of 6px bars. Driven by `order.status` and `order.events[]`.

### FilterSheet
Bottom sheet (`rounded-xl` top corners, 5px grab handle, `animate-sheet-in`) with chip groups per facet, colour swatches, a price range slider (two 24px thumbs, `primary` track), and footer buttons Reset (outline) and "Show N wigs" (primary). The live count comes from the facet API. On ≥ 768px it becomes a right drawer.

### Countdown
Three `primary` boxes HH MM SS in display 700. Counts down to `promotion.endsAt` (server time, synced on mount). At 0 the strip hides itself. The countdown is not a live region; announce "Ends in 3 hours 41 minutes" once via an `aria-label`.

---

## Admin composites

### AdminTopNav
White bar with a bottom `line` border: logo (34px `primary` square "J" + "jetty admin"), nav links as pills (active: `surface-inverse` fill, white text), optional count badges (Orders, Reviews), search pill, avatar. Wraps to multiple lines on narrow screens; below 768 consider collapsing the links into a menu button. Items: Overview, Orders, Products, Customers, Promotions, Storefront, Reviews, Team, Settings. Hide items the signed-in role can't access (see Team & roles).

### Card / Panel
White, 1px `line` border, `rounded-card`, 18–20px padding, title in `text-heading-xs`. A "highlight" variant uses a `primary` fill (revenue) or `surface-inverse` fill (customers, rating).

### KPI tile
Label (`muted`), value (display 800, 26px; 44px for the hero metric), delta pill (success ▲ / danger ▼) with "vs previous period". Skeleton while loading.

### Charts
Line chart (revenue, current vs previous period dashed), horizontal bar meters (funnel, categories, rating breakdown), stacked split bar (new vs returning). Follow the repo's dataviz conventions: label axes, give every chart an `aria-label` summary, and use a single hue (`primary`) with `primary`/`pink-450` for the comparison series.

### DataTable
For orders, customers and team. Header row in `muted` `text-caption` 600; rows divided by `line-soft`; the first cell is a button that opens the row's drawer; the selected row gets a `surface-tint` background. Wrap it in `overflow-x: auto` with a min-width (≈620px). Supports cursor pagination ("Showing 1–8 of 1,842", Previous/Next) and multi-select checkboxes where bulk actions exist.

### SideDrawer
**Every detail view** (order, customer, product editor) is a side drawer. Behaviour:
- Opens from a row/card click; the list stays in place behind a `scrim` overlay.
- Width `min(480px, 100%)`: full-screen below 480px and anchored right above that. Full viewport height (`100dvh`), body scrolls inside.
- Sticky header: context label ("Order details") on the left, 44px close button on the right.
- Animation: `animate-drawer-in` plus `animate-scrim-in`.
- Closes on the close button, a scrim click or Esc; focus returns to the row that opened it.
- URL-addressable: `?order=JH-10482` (or a parallel route) so a refresh or shared link reopens it.
- Unsaved changes: if a form inside is dirty, closing asks "Discard changes?".

### FormSection & InlineEditor
Used in the product Variants tab and the storefront inspector. An inline editor opens in place under the thing it edits (`surface-tint` panel, `rounded-md`) rather than in a modal. It contains: a title, fields, an **impact note** (info icon + plain-language consequence, e.g. "Creates 270 new variants…"), and actions Save (primary) / Cancel (outline) / Delete (text-danger, far right). Delete opens an inline confirmation (`danger-bg`) offering three choices: "Yes, delete", "Hide it instead" (the recommended safer option) and "Keep it".

### StorefrontEditor parts
SectionList (sortable, eye toggle, drag handle plus keyboard ↑/↓ alternatives), LivePreview (phone/desktop frame; clicking a block selects it and draws a `primary` outline with a name tag), Inspector (per-section forms), SectionLibrary dialog (grid of block types). See [screens/admin/storefront-editor.md](./screens/admin/storefront-editor.md).

### EmptyState
Dashed `line-accent` border, `rounded-card`, centred title (display 800, 22) and one line of help. An optional single action. Examples: "All caught up", "No orders match these filters", "No products yet. Add your first wig".

### Toast / inline status
Prefer inline status next to the action ("Added to bag · View bag", "Account created"). Use a toast only for background results (a publish finished, a CSV is ready): bottom-centre, `surface-inverse` pill, 4s, `role="status"`.
