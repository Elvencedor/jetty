export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          Monorepo scaffold
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Jetty&rsquo;s Hair</h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          Storefront placeholder. Build the catalog, cart and checkout flows described in{" "}
          <code className="font-mono text-sm">docs/FEATURES.md</code>.
        </p>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 text-sm dark:border-neutral-800 dark:bg-neutral-800">
        <div className="flex items-baseline justify-between gap-4 bg-white p-4 dark:bg-neutral-950">
          <dt className="text-neutral-500">Storefront</dt>
          <dd className="font-mono text-xs">localhost:3000</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 bg-white p-4 dark:bg-neutral-950">
          <dt className="text-neutral-500">API</dt>
          <dd className="font-mono text-xs">localhost:4000/api/v1</dd>
        </div>
      </dl>

      <p className="text-sm text-neutral-500">
        Call the API with <code className="font-mono">apiFetch</code> from{" "}
        <code className="font-mono">src/lib/api.ts</code>.
      </p>
    </main>
  );
}
