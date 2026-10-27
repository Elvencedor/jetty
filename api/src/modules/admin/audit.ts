import type { Request } from '@hapi/hapi';
import type { Db, Tx } from '../../db/client.js';
import { adminAuditLog } from '../../db/schema/index.js';

export type AuditEntry = { action: string; resourceType: string; resourceId?: string | undefined; before?: unknown; after?: unknown };

/** Appends to the audit log. Pass the open transaction so the record commits or rolls back with the change it describes. */
export async function audit(db: Db | Tx, request: Request, entry: AuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminUserId: request.auth.credentials.adminId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    beforeJson: entry.before ?? null,
    afterJson: entry.after ?? null,
    requestId: request.app.requestId ?? null,
  });
}
