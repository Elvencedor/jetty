import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { productCollections, products, promotions } from '../../db/schema/index.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { lifecycleSql } from './promotions.js';

type Scope = { include?: { allProducts?: boolean; productIds?: string[]; collectionIds?: string[] }; excludeProductIds?: string[] };

/**
 * How a promotion relates to one product.
 * - `attached`: the promotion names this product.
 * - `collection`: it applies through a collection the product is in.
 * - `all`: it applies to every product.
 * - `excluded`: it applies to others but names this product as an exception.
 * - `available`: it is limited to some products or collections and does not include this one yet, so this product can be added.
 */
export type ProductPromotionRelation = 'attached' | 'collection' | 'all' | 'excluded' | 'available';

const everything = (s: Scope) => s.include?.allProducts === true || ((s.include?.productIds ?? []).length === 0 && (s.include?.collectionIds ?? []).length === 0);

/** The promotions that matter to a product: live, scheduled and switched-off ones. Drafts are still being written in Promotions, so they are not listed here; ended ones and free delivery (which has no product scope) are not either. */
export async function promotionsForProduct(db: Db, productId: string) {
  const [exists] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!exists) throw notFound('Product not found.');
  const memberOf = new Set((await db.select({ id: productCollections.collectionId }).from(productCollections).where(eq(productCollections.productId, productId))).map((r) => r.id));
  const rows = (await db.execute(sql`
    select p.id, p.name, p.kind, p.status, (${lifecycleSql}) as lifecycle, p.configuration, p.scope, p.starts_at, p.ends_at, p.usage_count
    from promotions p
    where p.kind <> 'free_delivery' and (${lifecycleSql}) not in ('ended', 'draft')
    order by p.created_at desc, p.id desc`)) as unknown as Record<string, unknown>[];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    data: rows.map((r) => {
      const scope = (r.scope ?? {}) as Scope;
      const productIds = scope.include?.productIds ?? [];
      const collectionIds = scope.include?.collectionIds ?? [];
      const relation: ProductPromotionRelation = (scope.excludeProductIds ?? []).includes(productId)
        ? 'excluded'
        : productIds.includes(productId)
          ? 'attached'
          : collectionIds.some((c) => memberOf.has(c))
            ? 'collection'
            : everything(scope)
              ? 'all'
              : 'available';
      return {
        id: r.id as string,
        name: r.name as string,
        kind: r.kind as string,
        lifecycle: r.lifecycle as string,
        configuration: r.configuration as Record<string, unknown>,
        startsAt: iso(r.starts_at),
        endsAt: iso(r.ends_at),
        usageCount: r.usage_count as number,
        relation,
        /** Whether this product can be taken off the promotion from the product (only when the promotion names it, and other products or collections remain). */
        removable: relation === 'attached' && (productIds.length > 1 || collectionIds.length > 0),
      };
    }),
  };
}

async function load(tx: Db | Tx, promotionId: string) {
  const [row] = await tx.select().from(promotions).where(eq(promotions.id, promotionId)).for('update');
  if (!row) throw notFound('Promotion not found.');
  if (row.status === 'expired' || (row.endsAt !== null && row.endsAt <= new Date())) throw conflict('PROMOTION_ENDED', 'This promotion has ended. Extend its end date in Promotions first.');
  if (row.kind === 'free_delivery') throw unprocessable('VALIDATION_FAILED', 'Free delivery is not tied to products.', [{ path: 'promotionId', code: 'any.invalid' }]);
  return row;
}

/** Adds the product to a promotion that is limited to chosen products or collections. A promotion for every product is refused: adding one product would narrow it to that one. */
export async function attachProductToPromotion(db: Db, productId: string, promotionId: string) {
  return db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId));
    if (!product) throw notFound('Product not found.');
    const before = await load(tx, promotionId);
    const scope = (before.scope ?? {}) as Scope;
    if (everything(scope)) throw unprocessable('VALIDATION_FAILED', 'This promotion already applies to every product.', [{ path: 'promotionId', code: 'any.invalid' }]);
    const productIds = [...new Set([...(scope.include?.productIds ?? []), productId])];
    const next: Scope = {
      ...scope,
      include: { ...(scope.include ?? {}), productIds },
      excludeProductIds: (scope.excludeProductIds ?? []).filter((id) => id !== productId),
    };
    if (next.excludeProductIds?.length === 0) delete next.excludeProductIds;
    const [after] = await tx.update(promotions).set({ scope: next, updatedAt: new Date() }).where(eq(promotions.id, promotionId)).returning();
    return { before, after: after! };
  });
}

/** Takes the product off a promotion that names it. Refused when that would leave the promotion with nothing chosen, because that means every product. */
export async function detachProductFromPromotion(db: Db, productId: string, promotionId: string) {
  return db.transaction(async (tx) => {
    const before = await load(tx, promotionId);
    const scope = (before.scope ?? {}) as Scope;
    const productIds = scope.include?.productIds ?? [];
    if (!productIds.includes(productId)) throw unprocessable('VALIDATION_FAILED', 'This promotion does not name the product. If it applies through a collection, change the collection in Promotions.', [{ path: 'promotionId', code: 'any.invalid' }]);
    const remaining = productIds.filter((id) => id !== productId);
    if (remaining.length === 0 && (scope.include?.collectionIds ?? []).length === 0) {
      throw conflict('PROMOTION_WOULD_WIDEN', 'This is the only product on the promotion, so removing it would make it apply to every product. Switch the promotion off or edit it in Promotions instead.');
    }
    const include = { ...(scope.include ?? {}), productIds: remaining };
    if (remaining.length === 0) delete (include as { productIds?: string[] }).productIds;
    const [after] = await tx.update(promotions).set({ scope: { ...scope, include }, updatedAt: new Date() }).where(eq(promotions.id, promotionId)).returning();
    return { before, after: after! };
  });
}
