# Handoff spec: Shop / listing (B02)

Canvas artboard: `B02 · Shop / Listing` · reference: [`reference/PinkShop.dc.html`](../../reference/PinkShop.dc.html)
Route: `/shop` and `/shop/[collection]` (e.g. `/shop/frontal-wigs`); search results reuse it as `/search?q=` · Data: `GET /collections/{slug}/products`, `GET /products?q=` · Features: DISC-02…10, DISC-12, CMS-05

## Overview
Lets shoppers narrow 24+ styles to a few in seconds. Filters, sort and view mode live in the URL (`?texture=body-wave&lace=hd&sort=priceAsc&view=list`) so results can be shared and the back button works.

## Layout (mobile)
1. **Pink header block** (`surface-tint`, bottom corners `rounded-xl`, 16px padding): row of back IconButton, breadcrumb (Home › Wigs › Frontal), bag IconButton. Then the title "Frontal wigs" (display-md, can wrap to 2 lines) and a grid/list SegmentedControl on the right. Then a pill search scoped to the collection.
2. **Filter pills row** (horizontal scroll): a dark "All filters · N" pill opens the FilterSheet; facet pills (Texture ▾, Lace ▾, Length ▾, Price ▾) open the same sheet scrolled to that facet. A pill with an active value gets `choice-soft` selected styling.
3. **Results meta**: "24 wigs" left; Sort select right (Popular, Newest, Price ↑, Price ↓, Top rated).
4. **Grid**: 2 columns, 10px gap x, 14px gap y, ProductCard `grid`. After the 4th card, an **in-feed promo card** (CMS-05) spans both columns: `primary` fill, "1+1", "Buy 1 bob, get 1 free", "Mix any two. Ends Sunday.", arrow.
5. **List view**: ProductCard `list` stacked with 10px gaps; no in-feed promo.
6. "Show more (16)" outline button. It loads the next cursor page and appends. Keep focus on the first new card.
7. BottomTabBar (Shop active).

## FilterSheet
Opened by any pill. Groups: Texture, Lace, Length (chips, multi-select), Colour (40px swatches with labels), Price (range slider + "₦80,000 – ₦250,000"), plus "In stock only" and "On offer" toggles (DISC-06). Footer: Reset (outline) and "Show N wigs" (primary). The count re-fetches on each change (debounced 250ms) and the button shows a spinner while counting. Results apply only when the button is pressed; closing without applying discards the changes.

## States and interactions
| Element | State | Behaviour |
|---|---|---|
| View toggle | grid/list | Updates `?view=`; remember the choice in localStorage |
| Facet chip | Toggle | `aria-pressed`; selected = `choice-soft` selected |
| Sort | Change | Re-fetch from the first page; scroll to the top of the results |
| Results | Loading | Keep the old results at 50% opacity with a skeleton for new pages; never blank the grid |
| Results | Empty | EmptyState: "No wigs match these filters" + "Clear filters" button + 4 best sellers below |
| Results | Error | Inline: "Couldn't load wigs. Try again" with a retry button |
| Wishlist | Toggle | As on Home |

## Edge cases
- 0 results after filtering: show the active filter chips so the user can remove one.
- More than 200 results: the API cursor handles it; "Show more" until done, then "That's everything".
- Long product names: clamp to 2 lines in the grid and 3 in the list.
- Out-of-stock product: keep it in results, show a "Sold out" badge, and push it to the end under "Popular" sort (confirm with the API team).
- Search with no results: "No results for "{q}"" + suggestions + popular categories.

## Accessibility
- Results count is announced in `role="status"` after filtering ("24 wigs").
- The FilterSheet is a dialog; on close, focus returns to the pill that opened it.
- The price slider has two thumbs with `aria-valuetext="₦80,000"`, plus number inputs as a fallback.
