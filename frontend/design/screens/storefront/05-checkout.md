# Handoff spec: Checkout (B05)

Canvas artboard: `B05 · Checkout (step by step)` · reference: [`reference/PinkCheckout.dc.html`](../../reference/PinkCheckout.dc.html)
Route: `/checkout` (steps as `?step=delivery|payment|review`) · Data: `POST /delivery/quotes`, `POST /pricing/quote`, `POST /checkout`, `POST /checkout/paystack/verify`, `GET /checkout/{orderId}/status` · Features: CHK-01…13, ACC-01

## Overview
A short, transparent, 3-step flow: **Delivery → Payment → Review**, one step per screen on mobile, with Back/Next in a sticky bar. Guest checkout is the default; there are no account walls.

## ⚠️ Differences from the canvas (follow these, not the mockup)
1. **Card fields**: the canvas shows card number, expiry and CVV inputs. Paystack is the launch provider (docs/README.md §5), so **do not build card inputs**. Choosing "Card" and placing the order calls `POST /checkout`, then opens Paystack's inline popup or redirect with the returned access code. Keep the card tile, the "Visa · Mastercard · Verve" meta and the security line.
2. **Bank transfer and USSD** are Paystack channels too (USSD is P1). The info text in the canvas is fine, but the account number or code is shown by Paystack, not by our UI.
3. **Express buttons** (Saved card ··4821, Bank app) are P1 (ACC-06/CHK-09). Hide them at launch.
4. **Delivery prices** in the canvas say "Free" because the sample order is over the threshold. Always render prices from `POST /delivery/quotes`.

## Layout (mobile)
- **Header**: back to bag, "Secure checkout" with lock icon (success colour), total pill (ink).
- **StepIndicator** under the header.
- **Step 1 · Delivery**: title "Where should we deliver?"; fields Full name, Phone (WhatsApp updates), Email for receipt, Address, State (select), Landmark (optional). Then "Delivery speed" radio cards: icon tile, title ("Today, 4–8pm"), note ("Same-day Lagos · order by 2pm"), price. The options come from the delivery quote for the entered state/area and refresh when the state changes.
- **Step 2 · Payment**: title "How would you like to pay?"; 2×2 radio tiles (Card, Bank transfer, USSD, Pay on delivery), each with an icon, title and meta; an info panel for the selected method; the security line. Pay on delivery shows only when the delivery quote says it's eligible (Lagos, under the POD limit).
- **Step 3 · Review**: item list (thumbnail, name, variant, price), Delivery and Payment summary rows each with an Edit button that jumps back, PriceSummary `review`, and a terms line with links.
- **Sticky bar**: Back (outline, from step 2) + primary. Labels: "Continue to payment" → "Review order" → method-specific final label: "Pay ₦251,050" / "Get transfer details" / "Get USSD code" / "Place order".

## Validation
- Validate on blur and on Next; on failure, scroll to and focus the first invalid field. Messages: "Enter your full name", "Enter a Nigerian phone number, e.g. 0803 123 4567", "Enter a valid email", "Choose your state".
- Phone: accept `0803…`, `+234…` and `234…`; normalise to E.164 before sending.
- Keep step data in sessionStorage so a reload doesn't lose it.

## Payment flow states
| State | UI |
|---|---|
| Submitting `POST /checkout` | Final button spinner; disable the whole form; `aria-busy` |
| Paystack popup open | Keep the page dimmed; if the user closes the popup → toast "Payment not completed" and the button is re-enabled ("Try again") |
| Returned / callback | Show "Confirming your payment…" (full-width card, spinner), then poll `GET /checkout/{orderId}/status` every 2s for up to 60s |
| Paid | Redirect to `/order/{orderNumber}/confirmed` |
| Pending (transfer) | Stay on a "Waiting for your transfer" view with amount, reference and countdown; poll; customers can safely close (WhatsApp confirms later) |
| Failed | `role="alert"` card: "Your bank declined the payment. No money was taken." + "Try again" (`POST /checkout/{orderId}/payment-attempts`) and "Choose another method" |
| Quote changed at submit | Server returns a new total → show it in a warning card and require one more confirm tap |

## Edge cases
- Stock reserved but expired (too long on review): the server rejects it → message "Some items are no longer reserved. We've refreshed your bag." with a link back to the bag.
- Delivery not available to the address: show "We don't deliver to this area yet" under the State field + WhatsApp help.
- Very long address: the field grows (textarea at ≥ 2 lines on mobile).
- Double tap on Pay: the idempotency key from the client prevents duplicates (docs/API.md).

## Responsive (≥ 1024, recommended)
Two columns: steps on the left (`max-w-checkout`), order summary always visible on the right; the sticky bar becomes an in-flow button.

## Accessibility
- Each step is a `<form>` with a heading that receives focus on step change.
- The StepIndicator marks `aria-current="step"`; completed steps are buttons ("Edit delivery").
- Radio cards are in a `radiogroup` with arrow-key navigation.
