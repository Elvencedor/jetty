# Handoff spec: Admin · Products & variants (B-A2)

Reference: [`reference/PinkAdminProducts.dc.html`](../../reference/PinkAdminProducts.dc.html) · Route: `/admin/products` (drawer: `?product={id}&tab=variants`) · Data: `GET/POST /admin/products`, `GET/PATCH /admin/products/{id}` (If-Match), `PUT /admin/products/{id}/variants`, `PATCH /admin/inventory/{variantId}`, `POST /admin/media/upload-intents` · Features: CAT-01…11

## Overview
Catalog management for products with many variants (one wig can have 1,000+ combinations). The key UX problems are **scale** (any option can have many values) and **safe editing** (renaming, repricing and deleting option values affects hundreds of variants and live baskets).

## List
- Header: title, "64 products · 412 variants · 3 low on stock", Import CSV (outline), "+ New product" (primary).
- Status SegmentedControl (All · Active · Draft · Out of stock) + search pill.
- **Card grid** (auto-fill, min 200): image with a status pill and a featured-star toggle (`aria-pressed`, "Feature X on homepage"); name; "N variants · price range"; a stock meter (red under 10) with "N left". The selected card gets a 2px `primary` border. Clicking a card opens the drawer.

## Drawer: Edit product (SideDrawer)
Sticky header ("Edit product" + close) → product header (thumbnail, category, name, Save [dark]) → PillTabs: **Basics · Variants · Media · Merchandising**.

### Basics
Title, Description (textarea), Category (select), Status (Active/Draft). SEO fields (P1) collapsed under "Search engine listing".

### Variants: Options
One **option card** per option (Length, Lace, Density, Colour, Cap size): name, "N values · hint" (e.g. "sets the base price"), "+ Add {value}" (dashed). Values render as **wrapping chips**, which scale to any count. The chip shows the label, a colour dot (for Colour), and a delta ("+₦25k", "−₦20k" in success colour; length chips show the absolute price "₦185k"). Hidden values are 55% opacity with "· hidden".

**Add a value** (tap "+ Add lace"): an inline editor opens inside that card:
- "Name customers see" (placeholder per option: "e.g. Full lace 360")
- "Price difference (₦)" with a ± prefix; helper: for Length "Added to the ₦145,000 base. This length would cost ₦185,000 before other options.", others "Added to every variant with this lace. Use a minus for cheaper, e.g. -10000."
- Colour only: swatch picker (8 preset hair tones; custom hex is P2)
- **Impact note**: "Creates 270 new variants, one for every mix of the other options. They start at 0 stock, so customers won't see them until you add stock below."
- Save ("Add lace", disabled until there's a name) · Cancel

**Edit a value** (tap a chip): same editor prefilled, plus a "Show in store" switch and Delete. Impact note: "Used by 270 variants with 417 units in stock. Renaming updates the store straight away; past orders keep the old name."

**Delete** → inline confirmation (`danger-bg`): "Delete "13×6 HD"? This removes 270 variants and 417 units of stock. Past orders keep their details. Shoppers with it in their bag will be asked to choose again." Actions: **Yes, delete** (danger) · **Hide it instead** (recommended) · Keep it. If stock > 0, the server may refuse; then show "Move or sell the remaining stock first, or hide it instead."

"+ Add another option (e.g. Parting, Hair origin)" adds a new option card with an empty value list (P1).

### Variants: Variant list
- Header: "Variants · 1,080 combinations · 1,677 units".
- Filters: 3 selects (Lace, Density, Colour; "All" + values) + "Only show low or out of stock".
- **Groups by the first option (Length)**, collapsible: header "20" · 135 variants · 300 in stock · [12 low]". Expanded: up to 6 rows, then "+ N more in this length. Use the filters above to narrow down." (Implement real pagination or virtualisation; the 6-row cap is a mockup simplification.)
- Row: checkbox, name (other options joined with " · "), SKU, price, stock pill (success / warning ≤ 1 / danger "Sold out"). Tap → inline editor: computed price + "Custom price" checkbox (override), In stock −/+ (each change writes an inventory movement with reason "manual adjustment"), "Warn me below", SKU, Done.
- **Bulk bar** (sticky inside the drawer when rows are checked): "N selected · Set price · Add stock · ×".

### Media
3-column grid of images (drag to reorder; first = cover), "+ Upload" tile. Uploads go through upload intents; show per-file progress and errors (type/size). Helper: "Upload 24+ frames to turn on the 360° viewer."

### Merchandising
Switches: Feature on homepage, Eligible for coupons. Badge select: Auto / Featured / Best seller. Install-bundle items (chips + add).

## Edge cases
- Product with no options (care items): Variants tab shows a single price/stock/SKU form.
- Option values with duplicate names: block on save ("13×6 HD already exists").
- 10,000+ combinations: warn before adding a value that would exceed the limit agreed with the API (suggest 2,000).
- Concurrent edit (412): keep the user's draft, show a reload prompt.

## Accessibility
- Option chips are buttons named "Edit 13×6 HD"; the editor region is labelled by its title and receives focus on open.
- The delete confirmation is `role="alert"`; focus moves to "Hide it instead".
- Group headers are `aria-expanded` buttons.
