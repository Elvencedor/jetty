/**
 * Info pages every shop needs, written from policies the design already states (7-day returns, unworn with the lace
 * uncut, same-day Lagos delivery, 2-4 days elsewhere, the cap measurements). Plain statements only: nothing here
 * promises a fee, a deadline or a legal position the owner has not set.
 *
 * Terms and privacy are legal text, so they are seeded as **drafts**: they stay unpublished until the owner has
 * written or approved them in the admin. The checkout links to /pages/terms, so publish it before launch.
 */
export type StarterPage = { slug: string; title: string; status: 'published' | 'draft'; markdown: string };

export const STARTER_PAGES: StarterPage[] = [
  {
    slug: 'returns',
    title: 'Returns and refunds',
    status: 'published',
    markdown: `## Returning an item

You can return an item within **7 days of delivery** if it is **unworn and the lace is uncut**.

1. Message us on WhatsApp or email with your order number.
2. We will tell you how to send it back.
3. Once we have checked it, we start your refund and message you.

Refunds go back to the way you paid. Your bank may take a few days to show it.

## What we cannot take back

Wigs that have been worn, cut, dyed or altered, or that are missing their lace, cannot be returned.

## Something wrong with your order?

If an item arrives damaged or is not what you ordered, message us as soon as you open it and we will put it right.`,
  },
  {
    slug: 'delivery',
    title: 'Delivery',
    status: 'published',
    markdown: `## How delivery works

- **Lagos:** same-day delivery for orders placed before the daily cut-off, otherwise next day.
- **Other states:** usually 2 to 4 working days.
- **Showroom pickup:** collect your order from us when it is ready.

The delivery options, fees and estimated dates for your address are shown at checkout before you pay.

## Tracking your order

Use [Track an order](/track) with your order number and the phone number you ordered with. Signed-in customers can also see their orders under **Me**.`,
  },
  {
    slug: 'faqs',
    title: 'Frequently asked questions',
    status: 'published',
    markdown: `## Do I need an account to buy?

No. You can check out as a guest. An account lets you see your orders in one place.

## How can I pay?

By card or bank transfer, through Paystack. We never see your card details.

## How do I track my order?

Use [Track an order](/track) with your order number and phone number.

## What is your returns policy?

See [Returns and refunds](/pages/returns).

## How do I choose a cap size or length?

See the [size guide](/pages/size-guide).

## How do I look after my wig?

See the [care guide](/pages/care-guide).`,
  },
  {
    slug: 'size-guide',
    title: 'Size guide',
    status: 'published',
    markdown: `## Cap size

Measure around your hairline: from your forehead, over your ears, to the nape of your neck.

| Size | Measurement |
|---|---|
| S | 21" |
| M (most common) | 22.5" |
| L | 23.5" |

## Length

| Length | Where it falls |
|---|---|
| 10–14" | Bob |
| 16–18" | Shoulder |
| 20–22" | Mid-back |
| 24–26" | Waist |
| 28–30" | Hip |

Lengths are measured on straight hair, so curly and wavy textures look shorter when worn.`,
  },
  {
    slug: 'care-guide',
    title: 'Care guide',
    status: 'published',
    markdown: `## Looking after your wig

- Wash every 7 to 10 wears with a sulphate-free shampoo.
- Store it on a wig stand.
- Sleep in a silk bonnet.
- Detangle gently from the ends up.

If you are unsure about a product you have bought, message us and we will help.`,
  },
  {
    slug: 'contact',
    title: 'Contact us',
    status: 'published',
    markdown: `We are happy to help with choosing a wig, an order, or a return. Reach us any of these ways.`,
  },
  {
    slug: 'terms',
    title: 'Terms of sale',
    status: 'draft',
    markdown: `Replace this with your terms of sale, then publish the page. The checkout links here.`,
  },
  {
    slug: 'privacy',
    title: 'Privacy policy',
    status: 'draft',
    markdown: `Replace this with your privacy policy, then publish the page. The cookie notice links here.`,
  },
];
