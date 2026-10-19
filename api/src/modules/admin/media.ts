import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { productMedia, productVariants, products } from '../../db/schema/index.js';
import { apiError, notFound, unprocessable } from '../../lib/errors.js';
import type { ObjectStorage } from '../media/storage.js';
import { uniqueViolation } from '../../lib/sql.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 5 * 60;
export const MEDIA_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
export const MEDIA_ANGLES = ['front', 'side', 'back', 'hairline', 'worn', 'scale', 'detail'] as const;

export const keyPrefix = (productId: string) => `products/${productId}/`;

/**
 * The server picks the object key, so a client can neither overwrite another
 * object nor write outside the product's prefix. Type and size are signed into
 * the URL, so the bucket itself rejects a mismatching upload.
 */
export async function createUploadIntent(db: Db, storage: ObjectStorage, input: { productId: string; contentType: string; sizeBytes: number }) {
  const ext = MEDIA_TYPES[input.contentType];
  if (!ext) throw unprocessable('UNSUPPORTED_MEDIA_TYPE', 'Upload a JPEG, PNG, WebP or AVIF image.');
  if (input.sizeBytes > MAX_UPLOAD_BYTES) throw unprocessable('FILE_TOO_LARGE', `Images can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
  if (!product) throw notFound('Product not found.');
  const objectKey = `${keyPrefix(input.productId)}${randomUUID()}.${ext}`;
  const intent = storage.presignUpload({ key: objectKey, contentType: input.contentType, sizeBytes: input.sizeBytes, expiresInSeconds: UPLOAD_TTL_SECONDS });
  return { objectKey, upload: intent };
}

export type MediaFields = {
  altText?: string | null | undefined;
  angle?: (typeof MEDIA_ANGLES)[number] | null | undefined;
  variantId?: string | null | undefined;
  isCover?: boolean | undefined;
  sortOrder?: number | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
};

async function assertVariant(db: Db, productId: string, variantId: string | null | undefined) {
  if (!variantId) return;
  const [v] = await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)));
  if (!v) throw unprocessable('VALIDATION_FAILED', 'That variant does not belong to this product.', [{ path: 'variantId', code: 'any.invalid' }]);
}

/** Registers an uploaded object against a product after confirming it really arrived and matches the rules. */
export async function finalizeMedia(db: Db, storage: ObjectStorage, productId: string, input: MediaFields & { objectKey: string }) {
  if (!input.objectKey.startsWith(keyPrefix(productId)) || input.objectKey.includes('..')) {
    throw unprocessable('VALIDATION_FAILED', 'The object key does not belong to this product.', [{ path: 'objectKey', code: 'any.invalid' }]);
  }
  await assertVariant(db, productId, input.variantId);
  const stored = await storage.head(input.objectKey);
  if (!stored) throw unprocessable('UPLOAD_NOT_FOUND', 'The file has not been uploaded yet.');
  if (stored.sizeBytes > MAX_UPLOAD_BYTES || (stored.contentType && !(stored.contentType in MEDIA_TYPES))) {
    throw unprocessable('UPLOAD_REJECTED', 'The uploaded file is not an allowed image.');
  }

  return db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).for('update');
    if (!product) throw notFound('Product not found.');
    const [{ n, next } = { n: 0, next: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${productMedia.sortOrder}) + 1, 0)::int` })
      .from(productMedia)
      .where(eq(productMedia.productId, productId));
    // The first image becomes the cover; asking for a new cover demotes the old one.
    const cover = n === 0 || input.isCover === true;
    if (cover) await tx.update(productMedia).set({ isCover: false }).where(eq(productMedia.productId, productId));
    try {
      const [row] = await tx
        .insert(productMedia)
        .values({
          productId,
          variantId: input.variantId ?? null,
          objectKey: input.objectKey,
          altText: input.altText ?? null,
          angle: input.angle ?? null,
          sortOrder: input.sortOrder ?? next,
          isCover: cover,
          width: input.width ?? null,
          height: input.height ?? null,
        })
        .returning();
      await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
      return row!;
    } catch (err) {
      if (uniqueViolation(err)) throw apiError(409, 'CONFLICT', 'That cover image conflicts with another request; try again.');
      throw err;
    }
  });
}

export async function updateMedia(db: Db, productId: string, mediaId: string, patch: MediaFields) {
  await assertVariant(db, productId, patch.variantId);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(productMedia).where(and(eq(productMedia.id, mediaId), eq(productMedia.productId, productId))).for('update');
    if (!before) throw notFound('Media not found.');
    if (patch.isCover === true) await tx.update(productMedia).set({ isCover: false }).where(eq(productMedia.productId, productId));
    const [after] = await tx
      .update(productMedia)
      .set({
        ...(patch.altText !== undefined ? { altText: patch.altText } : {}),
        ...(patch.angle !== undefined ? { angle: patch.angle } : {}),
        ...(patch.variantId !== undefined ? { variantId: patch.variantId } : {}),
        ...(patch.isCover !== undefined ? { isCover: patch.isCover } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.width !== undefined ? { width: patch.width } : {}),
        ...(patch.height !== undefined ? { height: patch.height } : {}),
      })
      .where(eq(productMedia.id, mediaId))
      .returning();
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
    return { before, after: after! };
  });
}

export async function deleteMedia(db: Db, productId: string, mediaId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(productMedia).where(and(eq(productMedia.id, mediaId), eq(productMedia.productId, productId))).returning();
    if (!row) throw notFound('Media not found.');
    // Keep a cover: promote the next image if the cover was removed.
    if (row.isCover) {
      const [next] = await tx.select({ id: productMedia.id }).from(productMedia).where(eq(productMedia.productId, productId)).orderBy(productMedia.sortOrder).limit(1);
      if (next) await tx.update(productMedia).set({ isCover: true }).where(eq(productMedia.id, next.id));
    }
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
    return row;
  });
}
