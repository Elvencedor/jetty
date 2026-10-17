# Handoff spec: Admin · Storefront editor (B-A6)

Reference: [`reference/PinkAdminStorefront.dc.html`](../../reference/PinkAdminStorefront.dc.html) · Route: `/admin/storefront` (`?section={id}`, `?tab=theme`) · Data: `GET/POST/PATCH /admin/content` (sections, banners, announcements, featured), `GET /storefront/home?preview=draft` · Features: CMS-01…11

## Overview
The owner arranges the homepage without help, safely. Design principles:
1. **What you see is what you edit.** The live preview is the main surface; clicking any block selects it.
2. **Nothing goes live by accident.** Every change is a draft until Publish (or Schedule).
3. **Plain language.** "Button goes to", "Hide after", "Which products?", not "CTA href", "TTL" or "query".
4. **Always reversible.** Undo, hide (instead of delete), and history.

## Layout
- **Toolbar** (white bar under the nav): title "Storefront"; tabs **Homepage · Theme & logo**; draft status ("● Draft · 3 unpublished changes" in warning, or "● Live · all changes published" in success); Undo; phone/desktop preview toggle; Schedule (outline); **Publish** (primary).
- **Three columns** (flex-wrap; they stack on narrow screens):
  - **Section list** (min 280): "Homepage sections", "8 of 10 showing", hint "Top to bottom, as customers see it. Drag, or use the arrows." Each row: drag handle, icon tile, name, one-line summary (or "Hidden from customers"), eye toggle. Selected row: `primary` 2px border + tint. Hidden rows are 60% opacity. Footer: "+ Add a section" (dashed).
  - **Live preview** (flex 2, min 420): caption "LIVE PREVIEW · click any part to edit it"; a device frame (phone 360px, radius 40; desktop 640px, radius 18) rendering the real storefront components with draft data. Hovering a block shows a `primary` outline; the selected block shows a 2px `primary` outline + a name tag. Hidden sections aren't rendered.
  - **Inspector** (min 320): selected section icon + name + help line; actions ↑ Move up, ↓ Move down, Hide/Show, Remove (danger-soft); then the section form; a tip footer: "Changes stay in a draft until you press Publish…".

## Inspector forms by section type
| Type | Fields |
|---|---|
| Announcement bar | Message list; each: text, "Links to", date range, on/off switch; "+ Add message". Messages rotate every 5s on the storefront |
| Hero cards | Card tabs (Card 1, Card 2, +). Per card: image dropzone ("Portrait 4:5, at least 1200px wide"), Small label, Headline (counter "21 / 40 characters. Short reads best on phones."), Button text, "Button goes to" (Collection / Product / Promotion picker), Card colour (4 swatches: Pink, Blush, Plum, White), Show from / Hide after |
| Product row ("Jetty's picks") | Section title; "Which products?" radio cards: I will pick them (sortable list + "Pick products") · Best sellers (automatic, updates daily) · Everything on promotion; Layout: 2 per row / 3 per row |
| Flash deal strip | "Which promotion?" select; info: countdown and wording come from the promotion; hides itself at the end |
| Story circles, Shop by length, Category tiles, Customer photos, Trust badges, Wig quiz, Text banner | Title + explanation; content is automatic or set in its own form (P1: per-item editing) |
| Theme & logo (tab) | Theme radio cards: Luxe editorial / Pink pop (3-colour preview dots), logo upload (SVG/PNG). Switching the theme previews instantly and is published like any other change |

## Section library (dialog)
"Add a section": "Pick a block. It is added below the selected section and you can fill it in straight away." Grid of 8 cards (icon, name, one-line help): Text banner, Product row, Hero cards, Countdown strip, Category tiles, Story circles, Customer photos, Trust badges. Adding inserts below the selection, selects it, and opens its form.

## Behaviour
- **Reorder**: drag (pointer and touch) or ↑/↓ buttons; keyboard: focus the drag handle, Space to lift, arrows to move, Space to drop, with an announcement ("Hero cards moved to position 2 of 10").
- **Undo**: the last 20 actions; Ctrl/Cmd+Z when focus isn't in a text field.
- **Autosave** of the draft every change (debounced 800ms) → the draft count updates. Two editors at once: show "Ife is also editing" and lock publish to the latest draft (P1).
- **Publish**: confirm sheet listing the changes ("Moved Flash deal strip above Jetty's picks; Hid Wig quiz; Changed hero card 1 colour") → Publish now. **Schedule**: date-time picker (WAT).
- **History** (P1): the last 20 publishes, each restorable.

## Edge cases
- Removing a section with scheduled content: warn "This section has a hero card scheduled for Oct 24."
- An expired hero card is auto-hidden on the storefront but stays in the editor, greyed "Ended Oct 19".
- An empty product row (automatic source returns 0): the preview shows "No products match right now; this section will be hidden".

## Accessibility
- The preview blocks are buttons named "Edit Hero cards".
- The section list is an `<ol>`; reordering is fully keyboard-operable as described.
- The draft status is a live region.
