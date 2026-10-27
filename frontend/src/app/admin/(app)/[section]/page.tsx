import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionStub } from "@/components/admin/SectionStub";
import { ADMIN_NAV, type AdminNavKey } from "@/lib/admin/nav";

// Sections whose screens are not built yet. A section gets its own folder (and so takes over from this page) as its
// phase lands. Any other path under /admin is not found (checked below).
const SECTIONS = ADMIN_NAV.filter((i) => i.key !== "overview");
export const generateStaticParams = () => SECTIONS.map((i) => ({ section: i.key }));

export async function generateMetadata({ params }: PageProps<"/admin/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: SECTIONS.find((i) => i.key === section)?.label ?? "Admin" };
}

export default async function AdminSectionPage({ params }: PageProps<"/admin/[section]">) {
  const { section } = await params;
  const item = SECTIONS.find((i) => i.key === section);
  if (!item) notFound();
  return <SectionStub section={item.key as AdminNavKey} />;
}
