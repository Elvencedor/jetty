# 01 · Foundations

Visual rules that every screen uses. Token names refer to [`tokens.css`](./tokens.css) (Tailwind 4 `@theme`). Use tokens in code, never raw hex or px; the values are listed here only so you can check them against the canvas.

## Design intent

"Pink pop" is a friendly, app-like shop for a Nigerian, mostly mobile audience. It uses bold rounded type, pill-shaped controls and soft pink surfaces on white. Two rules shape every decision:

1. **Mobile first.** Every storefront screen was designed at 390px wide. Touch targets are at least 44×44px. The primary action stays within thumb reach in a sticky bottom bar.
2. **No interruptions.** No pop-ups, interstitials or auto-opening modals. Promotions live in the page flow (announcement bar, hero cards, in-feed cards). The only overlays are ones the user opens themselves (filter sheet, drawers, section library).

## Colour

### Semantic roles

| Token | Value | Use | Don't |
|---|---|---|---|
| `primary` | #D61F69 | Primary CTAs, selected chip/tab fill, active tab bar item, focus ring, brand mark | Body text on white (use `primary-strong`) |
| `primary-strong` | #A3134F | Pink text and links on white or tint, "See all" links, delta labels | Large fills |
| `primary-deep` | #7E0E3D | Link hover; text on `pink-300`/`pink-350` image placeholders | |
| `on-primary` | #FFFFFF | Text and icons on `primary` | |
| `surface` | #FFFFFF | Storefront page, cards, drawers | |
| `surface-subtle` | #FFF7FA | Admin page background, quiet list items | |
| `surface-tint` | #FFF0F6 | Search fields, segmented-control track, info panels, icon-button fill | |
| `surface-blush` | #FFE0EC | Soft promo tiles, avatar fills | |
| `surface-inverse` | #2B0D1C | Bottom tab bar, sticky checkout bar, flash-deal strip, dark tiles, secondary dark buttons | |
| `ink` | #2B0D1C | All headings and body text | |
| `ink-soft` | #4A2536 | Secondary paragraphs (review bodies, tab content) | |
| `muted` | #74525F | Captions, meta, helper text, unselected tab labels | Placeholder text in inputs (OK) |
| `faint` | #B898A6 | Disabled text, drag handles, sold-out chip text | Any text that must be read (2.6:1) |
| `on-inverse-muted` | #FFC2DA | Secondary text on `surface-inverse` | |
| `line` / `line-strong` / `line-accent` / `line-soft` | #F3D6E2 / #EAC9D6 / #F2A1C2 / #FBE3EC | Card borders / input and chip borders / dashed "add" borders / row dividers | |
| `success`, `danger`, `warning`, `info` (+ `-bg`) | see tokens | Status pills, savings lines, alerts | Decoration |

### Contrast (measured)

| Pair | Ratio | Result |
|---|---|---|
| white on `primary` | 4.93 | AA for all text sizes |
| `primary-strong` on white / on `surface-tint` | 7.60 / 6.89 | AA |
| `muted` on white / `surface-tint` / `surface-subtle` | 6.74 / 6.12 / 6.40 | AA |
| `ink` on white | 17.8 | AAA |
| `on-inverse-muted` on `surface-inverse` | 11.9 | AAA |
| success / danger / warning / info on their `-bg` | 5.7 / 5.4 / 6.3 / 7.3 | AA |
| **#FFE0EC on `primary`** | **4.02** | **Fails for text under 24px.** The canvas uses it for secondary text on pink (home hero sub-copy, revenue-card labels, confirmation hero paragraph). Use white at 100% instead. |
| `faint` on white | 2.60 | Disabled and decoration only |

Selected vs unselected states never rely on hue alone. A selected chip changes fill (white → `primary`) and text colour, not just border colour.

## Typography

Two Google fonts, loaded with `next/font/google` in `src/app/layout.tsx` (this replaces Geist):

```ts
import { Bricolage_Grotesque, Figtree } from "next/font/google";
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-bricolage" });
const body = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-figtree" });
// <html className={`${display.variable} ${body.variable}`}>
```

| Token | Size / line-height / tracking | Font, weight | Where |
|---|---|---|---|
| `text-display-xl` | 44 / 0.95 / −1.2px | display 800 | Confirmation hero, revenue KPI |
| `text-display-lg` | 40 / 0.95 / −1px | display 800 | Home hero cards |
| `text-display-md` | 36 / 1 / −1px | display 800 | Admin page titles; PLP title (38px in canvas, use 36) |
| `text-heading-lg` | 30 / 1.05 / −0.8px | display 800 | PDP product name |
| `text-heading-md` | 26 / 1.1 | display 800 | Storefront section titles, checkout step titles, bag title |
| `text-heading-sm` | 22 / 1.15 | display 800 | Admin panel and drawer titles, flash strip numbers |
| `text-heading-xs` | 18 / 1.2 | display 800 | Admin card titles, price in sticky bar (22) |
| `text-body-lg` | 16 / 1.5 | body 700 | Primary CTA labels |
| `text-body` | 15 / 1.5 | body 400 | Storefront body (base size on customer pages) |
| `text-body-sm` | 14 / 1.45 | body 400–700 | Admin base size; product card names (600) |
| `text-label` | 13 / 1.4 | body 600 | Form labels, meta, chip labels |
| `text-caption` | 12 / 1.35 | body 400–700 | Helper text, captions, review meta |
| `text-micro` | 11 / 1.2 | body 700 | Badges, overlines (letter-spacing 0.6–0.8px, uppercase) |

Prices use **display 800**: 16px on cards, 17px in the bag, 22px in the PDP summary and sticky bars. Struck-through "was" prices use `text-caption` in `muted`.

Rules: no font sizes below 11px. Body text never uses display weight 800. Headlines use `text-wrap: balance` and paragraphs `text-wrap: pretty`.

## Spacing

Use Tailwind's default 4px scale. The canvas mostly uses these values:

| px | Tailwind | Typical use |
|---|---|---|
| 4–6 | `1`, `1.5` | Chip groups, swatch rows, icon–label gap |
| 8 | `2` | Card-internal gaps, button groups |
| 10–12 | `2.5`, `3` | List gaps, grid gaps on mobile |
| 14–16 | `3.5`, `4` | **Page gutter on mobile (16)**, card padding |
| 18–20 | `4.5`, `5` | Admin card padding, drawer padding |
| 22–28 | `6`, `7` | Gaps between storefront sections (≈28) |
| 32–36 | `8`, `9` | Admin page side padding (`clamp(16px, 3vw, 36px)`) |

The canvas uses some odd values (10, 14, 18, 22). Round them to the nearest Tailwind step; the layout tolerates ±2px.

## Shape

| Token | px | Use |
|---|---|---|
| `rounded-xs` | 8 | Badges, tags |
| `rounded-sm` | 12 | Thumbnails ≤ 56px, small inputs (variant editor) |
| `rounded-md` | 16 | Inputs (52px tall storefront, 44–46px admin), list rows, upload zones |
| `rounded-lg` | 20 | Product media in cards, list-view items, deal cards |
| `rounded-card` | 24 | Admin cards and panels, bag summary |
| `rounded-xl` | 28 | Home hero cards, sheets (top corners), PLP header (bottom corners) |
| `rounded-2xl` | 36 | Confirmation hero (bottom corners) |
| `rounded-pill` | full | All buttons, chips, segmented controls, tab bar, search fields |

## Elevation

The design is mostly flat. Separate things with tint and borders, not shadows. Only two shadows exist:

- `shadow-panel` for admin drawers and inline editors that float over content.
- `shadow-drawer` for the side drawer's left edge.

Overlays use the `scrim` colour (`rgb(43 13 28 / 0.45)`).

## Iconography

Inline 24×24 stroke icons, stroke width 1.8–2.2, round caps and joins, `currentColor`. Size 16–20px in controls and 24px in payment-method tiles. Use one icon set throughout. **Lucide** matches the canvas closely (shopping-bag, heart, search, sliders, chevron-*, x, check, star, truck, shield-check, rotate-ccw, message-circle, zap, gift, eye/eye-off, grip-vertical, upload). Icon-only buttons always get an `aria-label`. Never use emoji as icons.

## Imagery

All photos in the canvas are pink placeholder blocks (`photo-1…5` tones) labelled with the shot needed. Required shots per product: front, side, back, hairline/lace close-up, worn/lifestyle, scale (length on model), plus an optional 36-frame 360° set. Aspect ratios:

- 1 : 1.25 product cards (shop), 1 : 1.15 home picks
- 500px tall full-bleed PDP gallery on mobile (4:5)
- 4:5 hero card art, cut by the card's rounded corners

Use `next/image` with blur placeholders in the photo tones. Never stretch an image; crop it with `object-fit: cover`.

## Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Side drawer | Open | Slide in from right (`translateX(100%) → 0`) | 280ms (`duration-drawer`) | `ease-drawer` |
| Bottom sheet (filters) | Open | Slide up from bottom | 280ms | `ease-drawer` |
| Scrim | Open | Fade 0 → 1 | 200ms | ease-out |
| Close (drawer/sheet) | Close | Reverse of open | 200ms | `ease-standard` |
| Chips, tabs, switches | Select | Background/colour cross-fade; switch knob slides | 120–200ms | `ease-standard` |
| Accordion / stepper rows | Expand | Height auto with opacity | 200ms | `ease-standard` |
| Add to bag | Success | Inline status row fades in; bag badge count bumps (scale 1 → 1.15 → 1) | 200ms | `ease-standard` |
| Countdown (flash deal) | Every second | Digits change in place; no animation | — | — |

`prefers-reduced-motion: reduce` turns all of these into instant changes (handled globally in `tokens.css`).

## Responsive

| Breakpoint | Storefront | Admin |
|---|---|---|
| < 480 (`sm`) | As designed (390). Drawers and sheets are full-screen. | Top nav wraps; panels stack; drawer is full-screen |
| 480–767 | Same single column; product grid stays 2-up | Same as above |
| 768–1023 (`md`) | Product grids 3-up; PDP gallery and info side by side at ≥ 900px | Panels in 2 columns where the canvas uses flex-wrap |
| ≥ 1024 (`lg`) | **Not designed.** Swap the bottom tab bar for a top header (logo, search, categories, account, bag). Grids 4-up, `max-w-store` centred. Checkout becomes a 2-column layout (steps left, summary right). | As designed at 1440; content `max-w-admin` |

The canvas has no desktop storefront layouts. The ≥ 1024 behaviour above is a recommendation; confirm it with design before building.

## Accessibility baseline

- WCAG 2.1 AA. Contrast as tabled above.
- Real elements: `<button>`, `<a href>`, `<input>` with `<label>`. Chips that select are `<button aria-pressed>` or radios. Tabs use `role="tablist"`/`tab` with `aria-selected`. Switches are `role="switch" aria-checked`.
- Visible focus: 2px `primary` outline with 2px offset on every interactive element (not drawn in the canvas; add it).
- Drawers and sheets: `role="dialog" aria-modal="true"`, focus moves to the close button on open, focus is trapped while open and returned to the trigger on close, Esc closes.
- Live regions: add-to-bag confirmation, coupon result and stock warnings use `role="status"`; payment and form errors use `role="alert"`.
- Never use `100vh` for page layout (the mobile browser UI covers part of it); use `dvh` for full-screen overlays.
