# Handoff spec: Admin · Overview dashboard (B-A1)

Reference: [`reference/PinkAdminDashboard.dc.html`](../../reference/PinkAdminDashboard.dc.html) · Route: `/admin` · Data: `GET /admin/dashboard?from=&to=`, `GET /admin/analytics/revenue`, `/products`, `/promotions` (P1) · Features: ANL-01…09

## Overview
A morning check-in: "how are we doing, and what needs me today?" Insight first, actions second.

## Layout
- Header: date + "sample data" caption (remove in production) and greeting headline ("Hey Jetty, sales are up 18%"). Write the headline from the revenue delta: up / down / flat variants. Range SegmentedControl on the right: 7d · 30d · Quarter · Custom (opens a date-range picker). The range is kept in the URL.
- **Row 1** (flex-wrap): **Revenue card** (`primary` fill, flex 2, min 560): label, value (display-xl), delta pill (white/`primary-strong`), line chart (current solid white 3px, previous dashed `pink-350`, gridlines `pink-500`), x-axis dates with promotion annotations ("Sep 27 · BOGO bobs"). **KPI stack** (flex 1, min 280): Orders, Avg order value, Conversion, each with a delta pill.
- **Row 2** (auto-fit grid, min 300): **Orders to action** (2×2 tiles: To pack [`primary`], Out for delivery, Awaiting transfer [tint], Return request [ink]; each links to the Orders filter) · **Live campaigns** (tag tile, name, meta, revenue, uses; "Manage" → Promotions) · **Where shoppers drop off** (funnel bars + insight note).
- **Row 3**: **Best sellers** (flex 2: 5 product tiles with a rank badge, low-stock chip, units and revenue) · **Customers** (ink card: new vs returning numbers and split bar, top states, pending-reviews note → Reviews).

## States
| Element | State | Behaviour |
|---|---|---|
| Range | Change | All cards refetch; keep the old values dimmed until new data arrives |
| Any card | Empty (new store) | "No sales yet in this period" in the card; the chart shows a flat baseline |
| Any card | Error | Card-level retry; other cards unaffected |
| Insight note | No clear drop-off | Hide the note |

## Accessibility
- Revenue chart: `role="img"` with a generated summary ("Revenue ₦48.6M, up 18.4% on the previous 30 days; peak Sep 28"). Offer a "View as table" toggle.
- Delta pills include the word "up/down" for screen readers (▲ ▼ are decorative).
- Contrast: labels on the pink revenue card must be white (#FFE0EC fails).
