import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Prose } from "@/components/content/Prose";
import { Skeleton } from "@/components/ui";
import { getPageCached, getSettingsCached } from "@/lib/catalog/data";
import { formatDate } from "@/lib/format";
import { reportError } from "@/lib/monitoring";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug)) notFound();
  await connection();
  return getPageCached(slug);
}

/** The first sentence of the page, for search results and link previews. */
const summary = (markdown: string) =>
  markdown
    .replace(/[#>*_`\[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug).catch(() => null);
  if (!page) return { title: "Page not found", robots: { index: false } };
  return { title: page.title, description: summary(page.markdown), alternates: { canonical: `/pages/${slug}` } };
}

/** Contact details come from the store settings, so they are always the current ones. */
async function ContactDetails() {
  await connection();
  const settings = await getSettingsCached().catch((err) => (reportError(err, { source: "contact-page" }), null));
  if (!settings) return null;
  const { store } = settings;
  const whatsapp = store.whatsappNumber.replace(/\D/g, "");
  return (
    <dl className="flex flex-col gap-3 rounded-card bg-surface-tint p-5 text-body-sm">
      {whatsapp ? <div><dt className="font-bold">WhatsApp</dt><dd><a href={`https://wa.me/${whatsapp}`} rel="noopener noreferrer" className="text-primary-strong underline">{store.whatsappNumber}</a></dd></div> : null}
      {store.contactPhone ? <div><dt className="font-bold">Phone</dt><dd><a href={`tel:${store.contactPhone}`} className="text-primary-strong underline">{store.contactPhone}</a></dd></div> : null}
      {store.contactEmail ? <div><dt className="font-bold">Email</dt><dd><a href={`mailto:${store.contactEmail}`} className="text-primary-strong underline">{store.contactEmail}</a></dd></div> : null}
      {store.showroomAddress ? <div><dt className="font-bold">Showroom</dt><dd>{store.showroomAddress}{store.showroomHours ? <><br />{store.showroomHours}</> : null}</dd></div> : null}
    </dl>
  );
}

async function Content({ params }: Pick<PageProps<"/pages/[slug]">, "params">) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();
  return (
    <article className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-label text-muted">
        <Link href="/" className="text-muted">Home</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="font-semibold text-ink">{page.title}</span>
      </nav>
      <h1 className="font-display text-display-md font-extrabold">{page.title}</h1>
      <Prose>{page.markdown}</Prose>
      {slug === "contact" ? <ContactDetails /> : null}
      <p className="text-caption text-muted">Last updated {formatDate(page.updatedAt)}</p>
    </article>
  );
}

export default function StaticPage(props: PageProps<"/pages/[slug]">) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4">
      <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64" /></div>}>
        <Content params={props.params} />
      </Suspense>
    </div>
  );
}
