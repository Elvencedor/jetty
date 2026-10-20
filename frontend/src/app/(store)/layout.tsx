import { connection } from "next/server";
import { Suspense } from "react";
import { AnnouncementBar } from "@/components/shell/AnnouncementBar";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { getHomeCached, getSettingsCached } from "@/lib/catalog/data";
import { reportError } from "@/lib/monitoring";

async function Announcements() {
  await connection();
  const home = await getHomeCached().catch((err) => (reportError(err, { source: "store-layout" }), null));
  return home?.announcements.length ? <AnnouncementBar items={home.announcements} /> : null;
}

async function StoreFooter() {
  await connection();
  const settings = await getSettingsCached().catch((err) => (reportError(err, { source: "store-layout" }), null));
  return <Footer settings={settings} />;
}

/** Everything a shopper sees around a page. The shell never fails because the API is down: it renders without the extras. */
export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={null}>
        <Announcements />
      </Suspense>
      <Header />
      <main id="main" className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>
      <Suspense fallback={<div className="mt-16 h-64 bg-surface-subtle" />}>
        <StoreFooter />
      </Suspense>
      {/* usePathname() is request-time on dynamic routes, so the bar streams in; the placeholder holds its place. */}
      <Suspense fallback={<div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-30 h-14 border-t border-line bg-surface lg:hidden" />}>
        <BottomTabBar />
      </Suspense>
    </>
  );
}
