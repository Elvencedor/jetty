import type { Request } from '@hapi/hapi';
import Joi from 'joi';
import type { Db } from '../../../db/client.js';
import { apiError } from '../../../lib/errors.js';
import { audit, type AuditEntry } from '../../../modules/admin/audit.js';
import { db } from '../shared.js';

export { db, NO_STORE } from '../shared.js';

export const uuidParam = (name: string) => Joi.object({ [name]: Joi.string().uuid().required() });

/** Standard list paging for admin endpoints: `limit` (default 20, max 100) and an opaque `cursor`. */
export const pageQuery = {
  limit: Joi.number().integer().min(1).max(100).default(20),
  cursor: Joi.string().max(512),
};

export const slugSchema = Joi.string().trim().lowercase().min(1).max(160).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** A quoted ETag carrying the record's version counter (see `products.version`). */
export const etagFor = (version: number) => `"${version}"`;

/**
 * Enforces `If-Match` on edits: missing is 428; a version other than the current one is 412, with the current
 * version in the error details so the client can re-read and try again. The version only ever goes up, so a lower
 * one is an edit made against an old read, and a higher one is not a version this record has.
 */
export function assertIfMatch(request: Request, currentVersion: number): void {
  const header = request.headers['if-match'];
  if (!header) throw apiError(428, 'PRECONDITION_REQUIRED', 'Send the If-Match header with the ETag you last read.');
  const match = /^(?:W\/)?"(\d+)"$/.exec(String(header).trim());
  const sent = match ? Number(match[1]) : NaN;
  if (sent === currentVersion) return;
  const message = sent > currentVersion ? 'That version does not exist yet. Reload and try again.' : 'This record changed since you loaded it. Reload and try again.';
  throw apiError(412, 'PRECONDITION_FAILED', message, [{ currentVersion }]);
}

/** Route options that require an admin holding at least one of `permissions`. */
export const guard = (...permissions: string[]) => ({ auth: 'admin' as const, plugins: { permission: permissions } });

/**
 * Runs a mutation and writes its audit record in the same transaction, so a change is never unaudited and an
 * audit failure never leaves a change behind. Modules receive the transaction as their `Db`; their own
 * transactions become savepoints.
 */
export async function audited<T>(request: Request, run: (tx: Db) => Promise<T>, entry: (result: T) => AuditEntry | null): Promise<T> {
  return db(request).transaction(async (tx) => {
    const result = await run(tx as unknown as Db);
    const record = entry(result);
    if (record) await audit(tx, request, record);
    return result;
  });
}
