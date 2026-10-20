import { Button } from "@/components/ui";

/** Placeholder home until phase 1 builds the storefront shell. It exists to prove the tokens, fonts and primitives. */
export default function Home() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-store flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-sm bg-primary font-display text-heading-xs font-extrabold text-on-primary">
          J
        </span>
        <span className="font-display text-heading-sm font-extrabold">Jetty&rsquo;s Hair</span>
      </div>

      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-micro font-bold uppercase tracking-[0.08em] text-primary-strong">Storefront under construction</p>
        <h1 className="font-display text-display-lg font-extrabold text-ink">Wigs you will love, delivered fast.</h1>
        <p className="text-body text-muted">The catalog, bag and checkout are being built in the order a shopper needs them. Follow the plan in docs/FRONTEND.md.</p>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" href="/shop">
            Shop wigs
          </Button>
          <Button size="lg" variant="outline" href="/track">
            Track an order
          </Button>
        </div>
      </div>
    </main>
  );
}
