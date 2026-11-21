import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

type Json = Record<string, unknown>;
const UUID = /^[0-9a-f-]{36}$/i;

const TABLES: [RegExp, string][] = [
  [/^\/admin\/categories\/([^/]+)$/, 'categories'],
  [/^\/admin\/collections\/([^/]+)$/, 'collections'],
  [/^\/admin\/content\/([^/]+)$/, 'content_entries'],
  [/^\/admin\/promotions\/([^/]+)$/, 'promotions'],
  [/^\/admin\/settings\/prep-times\/([^/]+)$/, 'delivery_prep_times'],
];

/**
 * What a real client does before an edit: reads the record's current version and sends it. Tests that are not about
 * versioning call this so their PATCHes carry the version, and leave one alone that already sends its own.
 */
export async function withVersion(db: Db, method: string, url: string, payload: Json | undefined, headers: Record<string, string>): Promise<{ payload: Json | undefined; headers: Record<string, string> }> {
  if (method !== 'PATCH') return { payload, headers };
  const read = async (table: string, id: string) => {
    if (!UUID.test(id)) return undefined;
    const rows = (await db.execute(sql.raw(`select version from ${table} where id = '${id}'`))) as unknown as { version: number }[];
    return rows[0]?.version;
  };

  if (url === '/admin/settings/delivery-zones' && payload && Array.isArray(payload.zones)) {
    const zones = await Promise.all(
      (payload.zones as Json[]).map(async (z) => (typeof z.id === 'string' && z.version === undefined ? { ...z, version: await read('delivery_zones', z.id) } : z)),
    );
    return { payload: { ...payload, zones }, headers };
  }
  if (Object.keys(headers).some((h) => h.toLowerCase() === 'if-match')) return { payload, headers };

  for (const [pattern, table] of TABLES) {
    const id = pattern.exec(url)?.[1];
    if (id) {
      const version = await read(table, id);
      return { payload, headers: version === undefined ? headers : { ...headers, 'if-match': `"${version}"` } };
    }
  }
  const key = /^\/admin\/settings\/([a-z]+)$/.exec(url)?.[1];
  if (key && key !== 'delivery-zones') {
    const rows = (await db.execute(sql`select version from store_settings where key = ${`app.${key}`}`)) as unknown as { version: number }[];
    return { payload, headers: { ...headers, 'if-match': `"${rows[0]?.version ?? 0}"` } };
  }
  return { payload, headers };
}
