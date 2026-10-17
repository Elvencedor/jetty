# Handoff spec: Admin · Orders & fulfilment (B-A4)

Reference: [`reference/PinkAdminOrders.dc.html`](../../reference/PinkAdminOrders.dc.html) · Route: `/admin/orders` (drawer `?order=JH-10482`) · Data: `GET /admin/orders`, `GET /admin/orders/{id}`, `PATCH /admin/orders/{id}/status`, `POST /admin/orders/{id}/confirm-transfer`, `PATCH /admin/orders/{id}/delivery` (P1), `POST /admin/orders/{id}/refunds` (P1) · Features: OPS-01…08

## Overview
Fulfilment staff move orders forward quickly. The design centres on **one obvious next step** per order.

## List
- Header: "Orders", "17 need action today", Export (outline), "+ Manual order" (dark, P2).
- Status filter pills with counts: All · Awaiting payment · To pack · Out for delivery · Delivered · Returns (selected = `primary` fill).
- Toolbar: search (order #, name, phone), date select, payment-method select.
- DataTable columns: Order (# + time; the cell is the drawer button), Customer, Items (up to 3 thumbnails), Status (StatusPill), Delivery (method · area), Total (right-aligned). Selected row: `surface-tint`.

## Drawer: Order details
1. Sticky header "Order details" + close.
2. Order number (display 800, 24) + StatusPill; "time · payment method"; 4-segment progress (Paid, Packed, On the way, Delivered).
3. **Next-step button** (primary, full width), labelled by status: Awaiting payment → "Confirm transfer received" (opens a confirm with the reference/evidence field) · To pack → "Mark as packed" · Packed → "Hand to rider" (requires a rider) · Out for delivery → "Mark as delivered" · Return requested → "Approve return". Helper: "The customer gets a WhatsApp and email update automatically."
4. Items (thumbnail, name, variant · SKU, price) + totals (Subtotal, combined discounts in success colour, Delivery, Paid).
5. Two info cards: **Customer** (name → Customers drawer, phone, "3rd order · ₦612k lifetime", "Message on WhatsApp" dark button → `https://wa.me/`) and **Delivery** (method, address, Rider select).
6. **Activity** log (dot, text, time) + internal note input (Enter to add; "customers can't see this").
7. Actions: Print packing slip (outline), Refund (outline → amount dialog: full / partial with reason), Cancel order (danger-soft → confirm with reason; releases stock).

## States
| Element | State | Behaviour |
|---|---|---|
| Next step | Loading | Spinner; on success the status pill, progress and list row update, and an activity entry is added |
| Next step | Invalid transition (409) | Inline error "This order was already marked packed by Grace at 12:05." + refresh |
| Hand to rider | No rider chosen | Button disabled with helper "Choose a rider first" |
| Filters | Empty | EmptyState "No orders here. Nice work." |

## Accessibility
- Status changes are announced (`role="status"`).
- Table rows aren't clickable as a whole; the order-number button is the target (keyboard friendly).
