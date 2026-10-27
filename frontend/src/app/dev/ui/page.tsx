import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata = { title: "UI gallery", robots: { index: false } };

/** Developer-only catalogue of the primitives, for visual and accessibility checks. It is a 404 in production. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
