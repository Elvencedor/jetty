/**
 * Mirrors the API's rule exactly (`permits` in the API): `*` grants everything, and holding `x:write` also grants
 * `x:read`. The API enforces this on every request; the screens use it only to hide what a role cannot use.
 */
export function permits(held: readonly string[], needed: string): boolean {
  if (held.includes("*") || held.includes(needed)) return true;
  return needed.endsWith(":read") && held.includes(`${needed.slice(0, -5)}:write`);
}

/** True if any one of `needed` is held (an empty list means "any signed-in admin"). */
export const permitsAny = (held: readonly string[], needed: readonly string[]) => needed.length === 0 || needed.some((p) => permits(held, p));
