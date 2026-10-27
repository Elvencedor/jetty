# Handoff spec: Home (B01)

Canvas artboard: `B01 · Home` · reference: [`reference/PinkHome.dc.html`](../../reference/PinkHome.dc.html)
Route: `/` · Data: `GET /storefront/home`, `GET /categories` · Features: DISC-01, DISC-11, DISC-12, CMS-01…06, CMS-10

## Overview
The shop window. It answers "what's new and what's on deal" in one thumb scroll and gives fast entry points by category, length and texture. **Every section is admin-managed** through the Storefront editor (B-A6): order, visibility and content come from `GET /storefront/home`, so render sections from a list, not hard-coded JSX.

## Layout (mobile, 390 wide)
Single column, 16px side gutter, about 28px between sections, 84px bottom padding for the tab bar.

Sections in their default order (each is a `HomeSection` keyed by `type`):

| # | Type | Content | Notes |
|---|---|---|---|
| — | Header (fixed, not a section) | 36px `primary` "J" logo tile + wordmark (display 800, 22) · notifications IconButton · bag IconButton with count | Logo links to `/` |
| — | Search row | Pill search input (`surface-tint`, 50px) + 50px `surface-inverse` filters button → `/shop` with the sheet open | Placeholder: "Try "bob", "26 inch", "glueless"". Type-ahead from `/products/suggestions` after 2 characters, debounced 200ms |
| 1 | `stories` | 72px circles: 3px ring (`primary` when new/promoted, `line-strong` otherwise), white inner ring, label below (`text-caption` 600, max 2 lines) | Horizontal scroll with scroll snapping; links to collections |
| 2 | `hero` | 320×380 cards, `rounded-xl`, horizontal scroll. Each card: tag pill, headline (display-lg, max 40 chars), CTA pill (`dark` on pink, `primary` on blush), photo cut-out bottom-right | Card colour comes from the editor swatch (pink/blush/plum/white). Hidden after `endsAt` |
| 3 | `flash` | `surface-inverse` strip: lightning icon, "Flash: 15% off frontals", "Code FLASH15 · ends in", Countdown | Bound to one promotion; hides at 0 |
| 4 | `quiz` | Dashed-border row: icon, "Not sure what to get?", subtitle, chevron | P2 (DISC-13). Hidden by default |
| 5 | `products` ("Jetty's picks") | Title + "See all" · PillTabs Featured / On deal / Care · 2-col grid of ProductCard `pick` (4 items) | Tab switch swaps the product list with no page reload; keep the grid height stable (skeleton) |
| 6 | `length` | 5 bars rising in height (62→150px), each a link: label "24–26"" + "Waist". Colours step from blush to ink | Links to `/shop?length=…`. Bars are `<a>` with full text labels |
| 7 | `tiles` | Bento: tall tile left (Frontal wigs, "From ₦145,000"), two stacked tiles right (Glueless; Hair care on ink) | |
| 8 | `ugc` | "#JettysHair girls" + subtitle; 140×200 photos with a white caption chip naming the product | From approved photo reviews; each links to its product |
| 9 | `trust` | `surface-tint` card, 2×2: icon tile + title + caption (Secure pay, 7-day returns, Same-day Lagos, Real reviews) | |
| — | Footer | Ink card: "Need a hand choosing?", WhatsApp CTA, links (Track order, Returns, Cap size guide, FAQs, email), payment methods line | Static content from settings |
| — | BottomTabBar | Home active | |

## Design tokens used
| Token | Usage |
|---|---|
| `primary` | Logo tile, story ring, primary hero card, countdown boxes, "+" buttons, active tab |
| `surface-tint` | Search field, icon buttons, tab track, trust card |
| `surface-inverse` | Filter button, flash strip, footer, tab bar, bogo badge |
| `text-display-lg` | Hero headlines |
| `text-heading-md` | Section titles |
| `rounded-xl` / `rounded-card` / `rounded-lg` | Hero cards / pick cards / media |

## States and interactions
| Element | State | Behaviour |
|---|---|---|
| Hero carousel | Swipe | Native horizontal scroll with `scroll-snap-type: x mandatory`; peeks the next card (320 of 358 visible). No auto-advance |
| Picks tabs | Select | Fetch `GET /storefront/home` section items for that tab (or the preloaded set); show 4 skeleton cards while loading |
| Wishlist heart | Tap (signed out) | Store in local wishlist; merge on login (WISH-01, P1). Fill `primary` when saved; `aria-pressed` |
| "+" on card | Tap | Go to the PDP (wigs need options). For single-variant items (care products) this may add directly; confirm with product |
| Bag icon | Count change | Count bumps (see Motion in foundations) |
| Countdown | Reaches 0 | Strip collapses (height → 0, 200ms); section removed |

## Responsive
- 480–1023: same stack; hero cards 360 wide; picks grid 3-up at ≥ 768.
- ≥ 1024 (not designed): top header replaces the tab bar; hero becomes a 2-card row; picks 4-up; stories centred.

## Edge cases
- **Empty section** (no items, expired promo): the API omits it; never render an empty title.
- **No stories or hero configured**: the page starts at picks. The search row must still be there.
- **Long headline** (> 40 chars): the editor blocks it. Defensive clamp to 3 lines.
- **Many stories** (> 8): keep scrolling; no "more" button.
- **Slow network**: the server-render section shell; images use blur placeholders.
- **Promotion ended between render and click**: the PLP shows the collection without the deal; no error.

## Accessibility
- Order: header → search → sections in order → footer → tab bar.
- The hero region is `<section aria-label="Offers">`; each card is a single link whose accessible name is the headline.
- Story circles are links with text labels (don't rely on the ring colour).
- Countdown: `aria-label="Offer ends in 3 hours 41 minutes"` set once, not live.
- Contrast fix: the hero sub-copy on pink must be white, not #FFE0EC (see foundations).
