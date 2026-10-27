/** Escapes `\`, `%` and `_` so user text matches literally inside LIKE/ILIKE. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `%text%` for a literal contains-match. */
export const likeContains = (s: string) => `%${escapeLike(s)}%`;

/** The violated constraint's name when `err` is a PostgreSQL unique violation (23505), otherwise undefined. */
export function uniqueViolation(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string; constraint_name?: string }; constraint_name?: string };
  return (e.cause?.code ?? e.code) === '23505' ? (e.cause?.constraint_name ?? e.constraint_name ?? 'unique') : undefined;
}
