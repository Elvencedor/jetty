# Handoff spec: Admin · Reviews moderation (B-A7)

Reference: [`reference/PinkAdminReviews.dc.html`](../../reference/PinkAdminReviews.dc.html) · Route: `/admin/reviews?status=pending` · Data: `GET /admin/reviews`, `PATCH /admin/reviews/{id}` · Features: MOD-01…02, REV-01…07

## Layout
- Header: "Reviews & questions" + "Only verified buyers can review. Nothing goes live until you approve it."
- Left (flex 999): status tabs with counts (Waiting · Published · Hidden · Questions [P2]); review cards: product thumbnail + name (link) + "Bought 20" · 180% · order #"; stars + reviewer + time; an optional **automatic flag** chip (warning: "Check: contains a phone number", "low rating about delivery, consider replying"); title; body; photos (72×88); actions: Approve (primary, pending only), "Pin to top of product" (toggle; pinned = tint + primary border), Reply publicly (P2), Hide (neutral, right).
- Right (flex 1): **Store rating** ink card (4.8, count, 5→1 bars) and **Asking for reviews** settings (Send the request: 7 days after delivery; Send by: WhatsApp then email; switches: Only verified buyers, Thank-you coupon [₦2,000 for a photo review], Auto-approve 5★ without flags).

## Behaviour
- Approve/Hide move the card out of the current tab with a 5s Undo row in its place.
- Keyboard shortcuts in the queue: A approve, H hide, J/K next/previous (shown in a "?" help popover).
- Empty: "All caught up · New reviews will show up here for approval."

## Accessibility
- Flags are text, not colour only.
- Stars are rendered as text with `aria-label="4 out of 5 stars"`.
