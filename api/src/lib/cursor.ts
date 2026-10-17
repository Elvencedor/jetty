import { badRequest } from './errors.js';

type CursorPayload = { sort: string; values: string[] };

/** Opaque keyset cursor: base64url JSON of the sort name and the last row's sort-key values. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string, sort: string, valueCount: number): string[] {
  const invalid = () => badRequest('The cursor is invalid or does not match the requested sort.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const p = parsed as Partial<CursorPayload> | null;
  if (
    !p ||
    p.sort !== sort ||
    !Array.isArray(p.values) ||
    p.values.length !== valueCount ||
    !p.values.every((v) => typeof v === 'string')
  ) {
    throw invalid();
  }
  return p.values;
}
