# Handoff spec: Admin · Settings (B-A9)

Reference: [`reference/PinkAdminSettings.dc.html`](../../reference/PinkAdminSettings.dc.html) · Route: `/admin/settings/[section]` · Data: `GET/PATCH /admin/settings/{key}` · Features: SET-01…06, NOT-01…02

## Layout
- **Left menu** (min 240; stacks on top on narrow screens): title "Settings" + items with an icon tile, label and note: Store details · Delivery & pickup · Payments · Notifications · Returns & policies · Tax & currency. Current item: ink fill, white text, `primary` icon tile; `aria-current="page"`.
- **Right panel** (min 640) per section, with a **Discard / Save changes** footer (save is disabled until dirty).

## Sections
- **Store details**: Store name, Support email, WhatsApp business number, Support hours, Showroom/pickup address. Link: "Logo, colours and fonts live in Storefront › Theme & logo."
- **Delivery & pickup**: zone cards (auto-fit, min 260): name + on/off switch, areas, delivery options (name, note, price; editable inline in P1). "+ Add zone". Below: Same-day order cutoff (select), Free delivery over (₦), Pay on delivery switch ("Lagos only, orders under ₦300,000"). Helper: "Customers only see options that apply to their address. Prices here are what checkout charges."
- **Payments**: Paystack connection card (status "Connected · live mode", payout bank, Manage). Method switches: Card, Bank transfer, USSD, Instalments (needs a partner; P2). "Cancel unpaid transfer orders after" (2h/6h/24h). In the canvas the provider shows as "[Payment gateway]"; use Paystack.
- **Notifications**: message table (Message + trigger, WhatsApp checkbox, Email checkbox) for Order confirmed, Transfer details, Out for delivery, Delivered, Review request, Abandoned bag. Clicking a message shows a **WhatsApp preview** bubble on the right with `{variables}`; "Edit wording" (P1). WhatsApp templates need Meta approval, so show the template status (Approved / Pending) once integrated.
- **Returns & policies**: Return window, Refund as, condition chips (Unworn, Lace uncut, Original packaging, + Add), policy page links (Returns, Delivery info [auto-filled from zones], Terms, Privacy (NDPR), FAQs).
- **Tax & currency**: Prices include/exclude VAT, VAT rate (placeholder until confirmed with an accountant), Currency (₦ only).

## States
- Saving: button spinner; success toast "Delivery settings saved"; error inline at the field.
- Turning off a zone that has open orders: confirm "3 open orders use Lagos Mainland. They will still be delivered."
