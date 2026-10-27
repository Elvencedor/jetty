# Handoff spec: Admin · Customers (B-A5)

Reference: [`reference/PinkAdminCustomers.dc.html`](../../reference/PinkAdminCustomers.dc.html) · Route: `/admin/customers` (drawer `?customer={id}`) · Data: `GET /admin/customers` (P0 list), profile, notes and segments are P1 · Features: CUS-01…04

## List
- Header: "Customers", count summary, Export CSV.
- **Segment tiles** (auto-fit, min 180): Everyone, VIP (5+ orders or ₦1M+), New (first order in 30 days), Returning (2+ orders), Lapsed (no order in 120 days). Each shows a count (display 800, 26), name and rule. Selected = `primary` fill. Segment rules are shown so staff understand them; editing segments is P2.
- Search pill (name, phone, email).
- DataTable: Customer (avatar initials on a photo tone, name, area; drawer button), Orders, Spent, Last order, Tags (segment pills).

## Drawer: Customer profile
Header (60px avatar, name, "Customer since Mar 2026 · Lekki, Lagos") → stat tiles (Orders, Spent, Avg order) → Contact (phone · email, default address "+1 more", WhatsApp [dark], "Send a coupon" [primary → a one-off code prefilled in the promotion builder]) → **Fit profile** chips (Length, Density, Cap, Colour, Texture; learned from orders; "Used for reorder and recommendations") → Recent orders (3 rows linking to the Orders drawer) → Marketing & privacy (WhatsApp offers / Email newsletter switches, reflecting the customer's own consent; changing them is logged) → Internal note (textarea, autosave) → Export data (NDPR) · Disable account (danger-soft, confirm).

## Edge cases
- Guest-only customers (no account): label "Guest", consent switches disabled with "Customer hasn't created an account".
- Customers with a data-erasure request: show a "Erasure requested" banner and lock editing.

## Accessibility
- Segment tiles are `aria-pressed` buttons.
- Consent switches have descriptive names ("Customer agreed to WhatsApp offers").
