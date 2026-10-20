import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-store flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-micro font-bold uppercase tracking-[0.08em] text-primary-strong">404</p>
      <h1 className="font-display text-heading-lg font-extrabold text-ink">We couldn&rsquo;t find that page</h1>
      <p className="max-w-md text-body text-muted">The link may be old, or the product may no longer be available.</p>
      <Button size="lg" href="/">
        Back to home
      </Button>
    </main>
  );
}
