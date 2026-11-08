import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { productMedia, productVariants, products } from '../../db/schema/index.js';
import { FakeStorage } from '../../testing/fake-storage.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { MAX_UPLOAD_BYTES, createUploadIntent, deleteMedia, finalizeMedia, keyPrefix, updateMedia } from './media.js';

const MISSING = '00000000-0000-4000-8000-000000000000';
const code = (e: unknown) => (e as { data?: { code?: string } }).data?.code;
const rejects = (p: Promise<unknown>, status: number, errCode?: string) =>
  assert.rejects(p, (e: { output: { statusCode: number } }) => e.output.statusCode === status && (!errCode || code(e) === errCode));

describe('product media service', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let storage: FakeStorage;
  let seq = 0;

  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });

  async function product() {
    storage = new FakeStorage();
    const n = ++seq;
    const [p] = await t.db.insert(products).values({ slug: `m-${n}`, title: `M${n}` }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: `MSKU-${n}`, optionSignature: {}, priceMinor: 100 }).returning();
    return { id: p!.id, variantId: v!.id };
  }
  const upload = (productId: string, name: string, size = 1000, type = 'image/jpeg') => {
    const key = `${keyPrefix(productId)}${name}`;
    storage.put(key, size, type);
    return key;
  };
  const rows = (productId: string) => t.db.select().from(productMedia).where(eq(productMedia.productId, productId)).orderBy(productMedia.sortOrder);

  describe('createUploadIntent', () => {
    it('signs an upload under the product prefix', async () => {
      const p = await product();
      const { objectKey, upload: intent } = await createUploadIntent(t.db, storage, { productId: p.id, contentType: 'image/webp', sizeBytes: 5000 });
      assert.ok(objectKey.startsWith(keyPrefix(p.id)) && objectKey.endsWith('.webp'));
      assert.equal(intent.method, 'PUT');
      assert.deepEqual(storage.presigned[0], { key: objectKey, contentType: 'image/webp', sizeBytes: 5000 });
    });
    it('refuses unknown products, bad types and oversized files without signing anything', async () => {
      const p = await product();
      await rejects(createUploadIntent(t.db, storage, { productId: MISSING, contentType: 'image/png', sizeBytes: 1 }), 404);
      await rejects(createUploadIntent(t.db, storage, { productId: p.id, contentType: 'image/svg+xml', sizeBytes: 1 }), 422, 'UNSUPPORTED_MEDIA_TYPE');
      await rejects(createUploadIntent(t.db, storage, { productId: p.id, contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES + 1 }), 422, 'FILE_TOO_LARGE');
      assert.equal(storage.presigned.length, 0);
    });
  });

  describe('finalizeMedia', () => {
    it('makes the first image the cover and appends later ones in order', async () => {
      const p = await product();
      const a = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg'), altText: 'front', angle: 'front' });
      const b = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'b.jpg') });
      assert.equal(a.isCover, true);
      assert.equal(b.isCover, false);
      assert.deepEqual([a.sortOrder, b.sortOrder], [0, 1]);
      assert.equal(a.altText, 'front');
      assert.equal(b.altText, null);
    });
    it('moves the cover when a new image asks for it', async () => {
      const p = await product();
      const a = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      const b = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'b.jpg'), isCover: true });
      assert.equal(b.isCover, true);
      const all = await rows(p.id);
      assert.equal(all.find((r) => r.id === a.id)!.isCover, false);
      assert.equal(all.filter((r) => r.isCover).length, 1);
    });
    it('rejects keys outside the product prefix or with path traversal', async () => {
      const p = await product();
      const other = await product();
      for (const objectKey of [`${keyPrefix(other.id)}x.jpg`, 'content/x.jpg', `${keyPrefix(p.id)}../${other.id}/x.jpg`]) {
        storage.put(objectKey);
        await rejects(finalizeMedia(t.db, storage, p.id, { objectKey }), 422, 'VALIDATION_FAILED');
      }
    });
    it('requires the file to have actually arrived', async () => {
      const p = await product();
      await rejects(finalizeMedia(t.db, storage, p.id, { objectKey: `${keyPrefix(p.id)}ghost.jpg` }), 422, 'UPLOAD_NOT_FOUND');
    });
    it('rejects stored objects that are too big or the wrong type', async () => {
      const p = await product();
      await rejects(finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'big.jpg', MAX_UPLOAD_BYTES + 1) }), 422, 'UPLOAD_REJECTED');
      await rejects(finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'x.jpg', 10, 'text/html') }), 422, 'UPLOAD_REJECTED');
      assert.equal((await rows(p.id)).length, 0);
    });
    it('only accepts a variant that belongs to the product', async () => {
      const p = await product();
      const other = await product();
      await rejects(finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg'), variantId: other.variantId }), 422, 'VALIDATION_FAILED');
      const ok = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'b.jpg'), variantId: p.variantId });
      assert.equal(ok.variantId, p.variantId);
    });
    it('returns 404 for a product that does not exist', async () => {
      await product(); // fresh storage
      await rejects(finalizeMedia(t.db, storage, MISSING, { objectKey: upload(MISSING, 'a.jpg') }), 404);
    });
    it('bumps the product version so editors see the change', async () => {
      const p = await product();
      const [before] = await t.db.select({ at: products.updatedAt }).from(products).where(eq(products.id, p.id));
      await new Promise((r) => setTimeout(r, 5));
      await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      const [after] = await t.db.select({ at: products.updatedAt }).from(products).where(eq(products.id, p.id));
      assert.ok(after!.at > before!.at);
    });
  });

  describe('updateMedia', () => {
    it('patches only the fields given', async () => {
      const p = await product();
      const m = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg'), altText: 'old', angle: 'front' });
      const { before, after } = await updateMedia(t.db, p.id, m.id, { altText: 'new' });
      assert.equal(before.altText, 'old');
      assert.equal(after.altText, 'new');
      assert.equal(after.angle, 'front');
    });
    it('can clear nullable fields', async () => {
      const p = await product();
      const m = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg'), altText: 'x', angle: 'side' });
      const { after } = await updateMedia(t.db, p.id, m.id, { altText: null, angle: null });
      assert.deepEqual([after.altText, after.angle], [null, null]);
    });
    it('keeps exactly one cover when another image is promoted', async () => {
      const p = await product();
      const a = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      const b = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'b.jpg') });
      await updateMedia(t.db, p.id, b.id, { isCover: true });
      const all = await rows(p.id);
      assert.equal(all.find((r) => r.id === b.id)!.isCover, true);
      assert.equal(all.find((r) => r.id === a.id)!.isCover, false);
    });
    it('404s for media of another product, and validates the variant', async () => {
      const p = await product();
      const other = await product();
      const m = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      await rejects(updateMedia(t.db, other.id, m.id, { altText: 'x' }), 404);
      await rejects(updateMedia(t.db, p.id, MISSING, { altText: 'x' }), 404);
      await rejects(updateMedia(t.db, p.id, m.id, { variantId: other.variantId }), 422);
    });
  });

  describe('deleteMedia', () => {
    it('promotes the next image when the cover is deleted', async () => {
      const p = await product();
      const a = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      const b = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'b.jpg') });
      const c = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'c.jpg') });
      await deleteMedia(t.db, p.id, a.id);
      const all = await rows(p.id);
      assert.deepEqual(all.map((r) => [r.id, r.isCover]), [[b.id, true], [c.id, false]]);
    });
    it('leaves the cover alone when a non-cover image is deleted', async () => {
      const p = await product();
      const a = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      const b = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'b.jpg') });
      await deleteMedia(t.db, p.id, b.id);
      assert.deepEqual((await rows(p.id)).map((r) => [r.id, r.isCover]), [[a.id, true]]);
    });
    it('can delete the last image, and 404s for unknown or foreign media', async () => {
      const p = await product();
      const other = await product();
      const a = await finalizeMedia(t.db, storage, p.id, { objectKey: upload(p.id, 'a.jpg') });
      await rejects(deleteMedia(t.db, other.id, a.id), 404);
      await deleteMedia(t.db, p.id, a.id);
      assert.equal((await rows(p.id)).length, 0);
      await rejects(deleteMedia(t.db, p.id, a.id), 404);
    });
  });
});
