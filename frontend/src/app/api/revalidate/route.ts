import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

const ALLOWED = new Set(["settings", "home", "catalog"]);

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The API calls this after an admin changes store settings or home content, so the storefront shows the change at
 * once instead of when its cache expires. It needs the shared secret and only accepts the tags listed above; without
 * `REVALIDATE_SECRET` set it is closed.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  const sent = request.headers.get("x-revalidate-secret") ?? "";
  if (!secret || secret.length < 16 || !same(sent, secret)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === "string" && ALLOWED.has(t)) : [];
  if (tags.length === 0) return NextResponse.json({ error: "Name at least one of: settings, home, catalog" }, { status: 400 });
  // An expiry of 0 makes the next visit fetch fresh data, rather than serving the old copy while it refreshes.
  for (const tag of new Set(tags)) revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ revalidated: [...new Set(tags)] });
}
