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

/** A quoted weak-validator ETag derived from a row's version timestamp. */
export const etagFor = (updatedAt: Date | string) => `"${new Date(updatedAt).getTime()}"`;

/** Enforces `If-Match` on concurrent edits: missing is 428, stale is 412. */
export function assertIfMatch(request: Request, current: string): void {
  const header = request.headers['if-match'];
  if (!header) throw apiError(428, 'PRECONDITION_REQUIRED', 'Send the If-Match header with the ETag you last read.');
  if (header !== current && header !== `W/${current}`) {
    throw apiError(412, 'PRECONDITION_FAILED', 'This record changed since you loaded it. Reload and try again.');
  }
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
