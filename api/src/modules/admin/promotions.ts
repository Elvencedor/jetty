import { asc, eq, inArray, sql } from 'drizzle-orm';
import Joi from 'joi';
import type { Db, Tx } from '../../db/client.js';
import { collections, products, promotionCodes, promotionHolds, promotions } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { normaliseCode } from '../pricing/load-promotions.js';
import { CONFIG_SCHEMAS, SCOPE_SCHEMA, type PromotionKind } from '../pricing/promotions.js';
import { uniqueViolation } from '../../lib/sql.js';
import { likeContains } from '../../lib/sql.js';

/** Kinds the pricing engine can apply today. `free_gift` is P1 and would silently never discount, so it is not creatable. */
export const SUPPORTED_KINDS = ['percentage', 'fixed_amount', 'buy_x_get_y', 'free_delivery'] as const;

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;

export type CodeInput = { code: string; maxRedemptions?: number | null | undefined; active?: boolean | undefined };

export type PromotionInput = {
  name: string;
  kind: (typeof SUPPORTED_KINDS)[number];
  configuration: Record<string, unknown>;
  scope?: Record<string, unknown> | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  priority?: number | undefined;
  stackable?: boolean | undefined;
  totalUsageLimit?: number | null | undefined;
  perCustomerLimit?: number | null | undefined;
  firstOrderOnly?: boolean | undefined;
  minimumSubtotalMinor?: number | null | undefined;
  codes?: CodeInput[] | undefined;
};

const invalid = (path: string, message: string) => unprocessable('VALIDATION_FAILED', message, [{ path, code: 'any.invalid' }]);

/** Applies the same versioned schemas the pricing engine uses, so nothing is saved that the engine would ignore. */
function normaliseRules(kind: PromotionKind, configuration: unknown, scope: unknown) {
  const cfg = (CONFIG_SCHEMAS[kind] as Joi.ObjectSchema).validate(configuration, { abortEarly: false });
  if (cfg.error) throw unprocessable('VALIDATION_FAILED', 'The promotion rule is not valid for this type.', cfg.error.details.map((d) => ({ path: `configuration.${d.path.join('.')}`, code: d.type, message: d.message })));
  const sc = SCOPE_SCHEMA.validate(scope ?? {}, { abortEarly: false });
  if (sc.error) throw unprocessable('VALIDATION_FAILED', 'The promotion scope is not valid.', sc.error.details.map((d) => ({ path: `scope.${d.path.join('.')}`, code: d.type, message: d.message })));
  return { configuration: cfg.value as Record<string, unknown>, scope: sc.value as Scope };
}

type Scope = { include?: { productIds?: string[]; collectionIds?: string[] }; excludeProductIds?: string[] };

async function assertScopeExists(db: Db | Tx, scope: Scope) {
  const productIds: string[] = [...new Set<string>([...(scope.include?.productIds ?? []), ...(scope.excludeProductIds ?? [])])];
  const collectionIds: string[] = scope.include?.collectionIds ?? [];
  if (productIds.length) {
    const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
    if (found.length !== productIds.length) throw invalid('scope', 'The scope refers to a product that does not exist.');
  }
  if (collectionIds.length) {
    const found = await db.select({ id: collections.id }).from(collections).where(inArray(collections.id, collectionIds));
    if (found.length !== new Set(collectionIds).size) throw invalid('scope', 'The scope refers to a collection that does not exist.');
  }
}

function assertWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined) {
  if (startsAt && endsAt && startsAt >= endsAt) throw invalid('endsAt', 'The end must be after the start.');
}

function normaliseCodes(codes: CodeInput[]) {
  const out = codes.map((c) => ({ ...c, code: normaliseCode(c.code) }));
  if (new Set(out.map((c) => c.code)).size !== out.length) throw invalid('codes', 'The same code is listed twice.');
  return out;
}

/** Derived lifecycle shown to admins: draft, inactive, scheduled, live or ended. */
export const lifecycleSql = sql`case
  when p.status = 'draft' then 'draft'
  when p.status = 'inactive' then 'inactive'
  when p.status = 'expired' or (p.ends_at is not null and p.ends_at <= now()) then 'ended'
  when p.starts_at is not null and p.starts_at > now() then 'scheduled'
  else 'live' end`;

export async function createPromotion(db: Db, adminId: string, input: PromotionInput) {
  const rules = normaliseRules(input.kind, input.configuration, input.scope);
  assertWindow(input.startsAt, input.endsAt);
  const codes = normaliseCodes(input.codes ?? []);
  try {
    return await db.transaction(async (tx) => {
      await assertScopeExists(tx, rules.scope);
      const [row] = await tx
        .insert(promotions)
        .values({
          name: input.name,
          kind: input.kind,
          configuration: rules.configuration,
          scope: rules.scope,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          priority: input.priority ?? 0,
          stackable: input.stackable ?? false,
          totalUsageLimit: input.totalUsageLimit ?? null,
          perCustomerLimit: input.perCustomerLimit ?? null,
          firstOrderOnly: input.firstOrderOnly ?? false,
          minimumSubtotalMinor: input.minimumSubtotalMinor ?? null,
          createdByAdminId: adminId,
        })
        .returning();
      if (codes.length) await tx.insert(promotionCodes).values(codes.map((c) => ({ promotionId: row!.id, code: c.code, maxRedemptions: c.maxRedemptions ?? null, active: c.active ?? true })));
      return row!;
    });
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('CODE_TAKEN', 'One of these codes is already used by another promotion.');
    throw err;
  }
}

export type PromotionPatch = Partial<Omit<PromotionInput, 'kind'>> & { kind?: PromotionInput['kind'] };

export async function updatePromotion(db: Db, id: string, patch: PromotionPatch) {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(promotions).where(eq(promotions.id, id)).for('update');
      if (!before) throw notFound('Promotion not found.');
      // An ended promotion can only be edited by moving its end date, which revives it.
      const ended = before.status === 'expired' || (before.endsAt !== null && before.endsAt <= new Date());
      if (ended && patch.endsAt === undefined) throw conflict('PROMOTION_ENDED', 'This promotion has ended. Extend its end date to edit it.');
      // Redemptions were granted under the old rule, so its type and currency are history.
      if (patch.kind && patch.kind !== before.kind && before.usageCount > 0) throw conflict('PROMOTION_IN_USE', 'A promotion that has been redeemed cannot change type. Create a new one.');

      const kind = (patch.kind ?? before.kind) as PromotionKind;
      const rules = normaliseRules(kind, patch.configuration ?? before.configuration, patch.scope ?? before.scope);
      if (patch.scope) await assertScopeExists(tx, rules.scope);
      const startsAt = patch.startsAt === undefined ? before.startsAt : patch.startsAt;
      const endsAt = patch.endsAt === undefined ? before.endsAt : patch.endsAt;
      assertWindow(startsAt, endsAt);

      const existingCodes = await tx.select().from(promotionCodes).where(eq(promotionCodes.promotionId, id));
      if (patch.codes) {
        const codes = normaliseCodes(patch.codes);
        // Turning an automatic promotion into a coded one would stop it applying to everyone, so only a non-live promotion may.
        if (existingCodes.length === 0 && codes.length > 0 && before.status === 'active') {
          throw conflict('PROMOTION_LIVE', 'Deactivate the promotion before adding its first code.');
        }
        for (const c of codes) {
          await tx
            .insert(promotionCodes)
            .values({ promotionId: id, code: c.code, maxRedemptions: c.maxRedemptions ?? null, active: c.active ?? true })
            .onConflictDoUpdate({
              target: promotionCodes.code,
              // The conflict target is global, so a code belonging to another promotion is never touched.
              // `code = excluded.code` is a no-op that keeps the statement valid when only the code itself was given.
              set: { code: sql`excluded.code`, ...(c.maxRedemptions !== undefined ? { maxRedemptions: c.maxRedemptions } : {}), ...(c.active !== undefined ? { active: c.active } : {}) },
              setWhere: eq(promotionCodes.promotionId, id),
            });
        }
        const owned = await tx.select({ code: promotionCodes.code }).from(promotionCodes).where(eq(promotionCodes.promotionId, id));
        const ownedSet = new Set(owned.map((o) => o.code));
        if (codes.some((c) => !ownedSet.has(c.code))) throw conflict('CODE_TAKEN', 'One of these codes is already used by another promotion.');
      }

      const [after] = await tx
        .update(promotions)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          kind,
          configuration: rules.configuration,
          scope: rules.scope,
          startsAt,
          endsAt,
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.stackable !== undefined ? { stackable: patch.stackable } : {}),
          ...(patch.totalUsageLimit !== undefined ? { totalUsageLimit: patch.totalUsageLimit } : {}),
          ...(patch.perCustomerLimit !== undefined ? { perCustomerLimit: patch.perCustomerLimit } : {}),
          ...(patch.firstOrderOnly !== undefined ? { firstOrderOnly: patch.firstOrderOnly } : {}),
          ...(patch.minimumSubtotalMinor !== undefined ? { minimumSubtotalMinor: patch.minimumSubtotalMinor } : {}),
          updatedAt: new Date(),
        })
        .where(eq(promotions.id, id))
        .returning();
      return { before, after: after! };
    });
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('CODE_TAKEN', 'One of these codes is already used by another promotion.');
    throw err;
  }
}

/** Activate/deactivate. The schedule is still enforced by the server on every quote, so activating a future promotion only arms it. */
export async function setPromotionState(db: Db, id: string, to: 'active' | 'inactive') {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(promotions).where(eq(promotions.id, id)).for('update');
    if (!before) throw notFound('Promotion not found.');
    if (to === 'active' && before.endsAt && before.endsAt <= new Date()) throw conflict('PROMOTION_ENDED', 'This promotion has already ended. Move its end date first.');
    const [after] = await tx.update(promotions).set({ status: to, updatedAt: new Date() }).where(eq(promotions.id, id)).returning();
    return { before, after: after! };
  });
}

export async function listAdminPromotions(
  db: Db,
  input: { q?: string | undefined; status?: 'draft' | 'inactive' | 'scheduled' | 'live' | 'ended' | undefined; limit: number; cursor?: string | undefined },
) {
  const where = [sql`true`];
  if (input.status) where.push(sql`(${lifecycleSql}) = ${input.status}`);
  if (input.q) where.push(sql`(p.name ilike ${likeContains(input.q)} or exists (select 1 from promotion_codes pc where pc.promotion_id = p.id and pc.code like ${likeContains(normaliseCode(input.q))}))`);
  let after = sql``;
  if (input.cursor) {
    const [at, id] = decodeCursor(input.cursor, 'admin-promotions', 2);
    after = sql`and (p.created_at, p.id) < (${at}::timestamptz, ${id}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select p.id, p.name, p.kind, p.status, (${lifecycleSql}) as lifecycle, p.starts_at, p.ends_at, p.priority, p.stackable,
      p.total_usage_limit, p.per_customer_limit, p.usage_count, p.created_at, p.created_at::text as cur_at,
      (select count(*)::int from promotion_codes pc where pc.promotion_id = p.id) as code_count,
      (select count(*)::int from promotion_holds h where h.promotion_id = p.id) as holds
    from promotions p where ${sql.join(where, sql` and `)} ${after}
    order by p.created_at desc, p.id desc limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    data: page.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as string,
      status: r.lifecycle as string,
      startsAt: iso(r.starts_at),
      endsAt: iso(r.ends_at),
      priority: r.priority as number,
      stackable: r.stackable as boolean,
      type: (r.code_count as number) > 0 ? 'code' : 'automatic',
      usage: { redemptions: r.usage_count as number, openHolds: r.holds as number, limit: (r.total_usage_limit as number | null) ?? null },
      createdAt: iso(r.created_at),
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: 'admin-promotions', values: [String(last.cur_at), String(last.id)] }) : null },
  };
}

export async function getAdminPromotion(db: Db, id: string) {
  const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
  if (!row) throw notFound('Promotion not found.');
  const [codes, stats, [holds]] = await Promise.all([
    db.select().from(promotionCodes).where(eq(promotionCodes.promotionId, id)).orderBy(asc(promotionCodes.code)),
    db.execute(sql`
      select count(*)::int as redemptions, coalesce(sum(r.discount_minor), 0)::bigint as discount_minor,
        coalesce(sum(o.total_minor), 0)::bigint as revenue_minor
      from promotion_redemptions r join orders o on o.id = r.order_id where r.promotion_id = ${id}`) as unknown as Promise<Record<string, unknown>[]>,
    db.select({ n: sql<number>`count(*)::int` }).from(promotionHolds).where(eq(promotionHolds.promotionId, id)),
  ]);
  const [lifecycle] = (await db.execute(sql`select (${lifecycleSql}) as v from promotions p where p.id = ${id}`)) as unknown as { v: string }[];
  return {
    promotion: { ...row, lifecycle: lifecycle!.v },
    codes,
    stats: { redemptions: stats[0]!.redemptions as number, discountMinor: Number(stats[0]!.discount_minor), orderRevenueMinor: Number(stats[0]!.revenue_minor), openHolds: holds?.n ?? 0 },
  };
}
