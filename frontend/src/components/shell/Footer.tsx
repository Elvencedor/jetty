import Link from "next/link";
import type { PaymentMethod, StoreSettings } from "@/lib/api/types";

const LINKS = [
  { href: "/track", label: "Track order" },
  { href: "/pages/returns", label: "Returns" },
  { href: "/pages/size-guide", label: "Cap size guide" },
  { href: "/pages/faqs", label: "FAQs" },
  { href: "/pages/care-guide", label: "Care guide" },
];
const PAYMENT_LABEL: Record<PaymentMethod, string> = { card: "Visa · Mastercard · Verve", bank_transfer: "Bank transfer" };

/**
 * The page's last card: a nudge to chat, the help links, contact details and accepted payments. `settings` is null
 * when the API could not be reached; the links still render. The bottom padding clears the floating tab bar.
 */
export function Footer({ settings }: { settings: StoreSettings | null }) {
  const store = settings?.store;
  const whatsapp = store?.whatsappNumber.replace(/\D/g, "");
  const payments = settings?.payments.enabledMethods.map((m) => PAYMENT_LABEL[m]).join(" · ");
  return (
    <footer className="px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 lg:pb-8">
      <div className="mx-auto flex max-w-store flex-col gap-3.5 rounded-card bg-surface-inverse p-5 text-on-inverse">
        <p className="font-display text-heading-sm font-extrabold">Need a hand choosing?</p>
        <p className="text-body-sm text-on-inverse-muted">Chat with a {store?.name ?? "Jetty"} stylist on WhatsApp{store?.showroomHours ? `, ${store.showroomHours}` : ""}.</p>
        {whatsapp ? (
          <a href={`https://wa.me/${whatsapp}`} rel="noopener noreferrer" className="inline-flex h-[46px] items-center self-start rounded-pill bg-primary px-5 font-bold text-on-primary">Chat with us</a>
        ) : null}
        <nav aria-label="Help" className="flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-surface-inverse-raised pt-2 text-label">
          {LINKS.map((l) => <Link key={l.href} href={l.href} className="text-on-inverse-muted underline-offset-2 hover:underline">{l.label}</Link>)}
          {store?.contactEmail ? <a href={`mailto:${store.contactEmail}`} className="text-on-inverse-muted underline-offset-2 hover:underline">{store.contactEmail}</a> : null}
        </nav>
        {store?.showroomAddress ? <p className="text-caption text-on-inverse-muted">{store.showroomAddress}</p> : null}
        {payments ? <p className="text-caption text-on-inverse-muted">{payments}</p> : null}
      </div>
    </footer>
  );
}
