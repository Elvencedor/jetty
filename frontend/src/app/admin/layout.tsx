import type { Metadata } from "next";
import { AdminProvider } from "@/components/admin/AdminProvider";

// The admin is for staff: it is never listed by search engines, and its pages have no public titles to leak.
export const metadata: Metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminProvider>{children}</AdminProvider>;
}
