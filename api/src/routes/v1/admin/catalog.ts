import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { apiError } from '../../../lib/errors.js';
import { changeStock, listInventory, STOCK_REASONS, type StockChange } from '../../../modules/admin/inventory.js';
import { createContentUploadIntent, createUploadIntent, deleteMedia, finalizeMedia, MEDIA_ANGLES, MEDIA_TYPES, MAX_UPLOAD_BYTES, updateMedia, type MediaFields } from '../../../modules/admin/media.js';
import { createProduct, deleteProduct, getAdminProduct, listAdminProducts, replaceMatrix, setProductStatus, updateProduct, type MatrixInput, type ProductFields, type ProductListInput } from '../../../modules/admin/products.js';
import { createCategory, createCollection, listCategories, listCollectionProducts, listCollections, setCollectionProducts, updateCategory, updateCollection } from '../../../modules/admin/taxonomy.js';
import { assertIfMatch, audited, db, etagFor, guard, NO_STORE, pageQuery, slugSchema, uuidParam } from './shared.js';

const write = guard('catalog:write');
const read = guard('catalog:read');

const text = (max: number) => Joi.string().trim().min(1).max(max);
const nullableText = (max: number) => Joi.string().trim().max(max).allow(null, '');
const ids = Joi.array().items(Joi.string().uuid()).max(100);

const productBody = {
  title: text(200),
  slug: slugSchema,
  description: nullableText(10_000),
  featured: Joi.boolean(),
  badgeOverride: nullableText(40),
  seoTitle: nullableText(120),
  seoDescription: nullableText(300),
  // Markdown for the product page tabs. Only these four sections exist; anything else is refused.
  tags: Joi.array().items(Joi.string().trim().min(1).max(40)).max(20),
  details: Joi.object({ details: Joi.string().max(10_000).allow(''), fit: Joi.string().max(10_000).allow(''), care: Joi.string().max(10_000).allow(''), delivery: Joi.string().max(10_000).allow('') }),
  categoryIds: ids,
  collectionIds: ids,
};

const blankToNull = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as T;

/** Upper bound agreed with the design handoff ("warn before exceeding 2,000"). */
const MAX_VARIANTS = 2000;

const matrixBody = Joi.object({
  options: Joi.array()
    .items(
      Joi.object({
        name: text(40).required(),
        values: Joi.array()
          .items(Joi.object({ label: text(60).required(), valueKey: Joi.string().trim().lowercase().pattern(/^[a-z0-9][a-z0-9._-]{0,39}$/).required(), // Negative differences are real (a closure costs less than a frontal); the price a customer pays is the variant's own.
          priceDeltaMinor: Joi.number().integer().min(-1_000_000_000).max(1_000_000_000), active: Joi.boolean(), swatch: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).allow(null) }))
          .min(1)
          .max(50)
          .required(),
      }),
    )
    .max(6)
    .required(),
  variants: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().uuid(),
        sku: Joi.string().trim().min(1).max(64).required(),
        optionValues: Joi.object().pattern(Joi.string(), Joi.string()),
        priceMinor: Joi.number().integer().min(0).max(1_000_000_000).required(),
        compareAtPriceMinor: Joi.number().integer().min(0).max(1_000_000_000).allow(null),
        active: Joi.boolean(),
        stock: Joi.number().integer().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(MAX_VARIANTS)
    .required(),
});

const mediaBody = {
  altText: nullableText(200),
  angle: Joi.string().valid(...MEDIA_ANGLES).allow(null),
  variantId: Joi.string().uuid().allow(null),
  isCover: Joi.boolean(),
  sortOrder: Joi.number().integer().min(0).max(10_000),
  width: Joi.number().integer().min(1).max(20_000).allow(null),
  height: Joi.number().integer().min(1).max(20_000).allow(null),
};

const withEtag = (h: ResponseToolkit, body: object, updatedAt: Date | string, code = 200) =>
  h.response(body).code(code).header('ETag', etagFor(updatedAt)).header('Cache-Control', NO_STORE);

const productId = (request: Request) => (request.params as { id: string }).id;

export const adminCatalogRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/admin/products',
    options: {
      ...read,
      description: 'Search and filter products',
      tags: ['api', 'admin'],
      validate: { query: Joi.object({ ...pageQuery, q: Joi.string().trim().min(1).max(100), status: Joi.string().valid('draft', 'active', 'archived'), stock: Joi.string().valid('out', 'low') }) },
    },
    handler: async (request, h) => h.response(await listAdminProducts(db(request), request.query as unknown as ProductListInput, request.server.app.storage)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'POST',
    path: '/admin/products',
    options: { ...write, description: 'Create a draft product', tags: ['api', 'admin'], validate: { payload: Joi.object({ ...productBody, title: text(200).required() }) } },
    handler: async (request, h) => {
      const created = await audited(request, (tx) => createProduct(tx, blankToNull(request.payload as ProductFields)), (created) => ({ action: 'product.create', resourceType: 'product', resourceId: created.id, after: { title: created.title, slug: created.slug } }));
      const detail = await getAdminProduct(db(request), created.id, request.server.app.storage);
      return withEtag(h, detail, created.updatedAt, 201);
    },
  },
  {
    method: 'GET',
    path: '/admin/products/{id}',
    options: { ...read, description: 'Full product with options, variants, stock and media', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => {
      const detail = await getAdminProduct(db(request), productId(request), request.server.app.storage);
      return withEtag(h, detail, detail.product.updatedAt);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/products/{id}',
    options: {
      ...write,
      description: 'Edit catalog fields; requires If-Match',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object(productBody).min(1) },
    },
    handler: async (request, h) => {
      const id = productId(request);
      const { after } = await audited(request, (tx) => updateProduct(tx, id, blankToNull(request.payload as Partial<ProductFields>), (updatedAt) => assertIfMatch(request, etagFor(updatedAt))), ({ before, after }) => ({ action: 'product.update', resourceType: 'product', resourceId: id, before: { title: before.title, slug: before.slug, featured: before.featured }, after: { title: after.title, slug: after.slug, featured: after.featured } }));
      return withEtag(h, await getAdminProduct(db(request), id, request.server.app.storage), after.updatedAt);
    },
  },
  {
    method: 'DELETE',
    path: '/admin/products/{id}',
    options: { ...write, description: 'Permanently delete a product and everything attached to it', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => {
      const id = productId(request);
      await audited(request, (tx) => deleteProduct(tx, id), (product) => ({ action: 'product.delete', resourceType: 'product', resourceId: id, before: { title: product.title, slug: product.slug, status: product.status } }));
      return h.response().code(204);
    },
  },
  ...(['publish', 'archive'] as const).map(
    (action): ServerRoute => ({
      method: 'POST',
      path: `/admin/products/{id}/${action}`,
      options: {
        ...write,
        description: `${action === 'publish' ? 'Publish' : 'Archive'} a product`,
        tags: ['api', 'admin'],
        validate: { params: uuidParam('id'), payload: action === 'publish' ? Joi.object({ publishAt: Joi.date().iso() }).allow(null) : Joi.any() },
      },
      handler: async (request, h) => {
        const id = productId(request);
        const publishAt = action === 'publish' ? (request.payload as { publishAt?: Date } | null)?.publishAt : undefined;
        const { after } = await audited(request, (tx) => setProductStatus(tx, id, action === 'publish' ? 'active' : 'archived', { publishAt }), ({ before, after }) => ({ action: `product.${action}`, resourceType: 'product', resourceId: id, before: { status: before.status }, after: { status: after.status, publishedAt: after.publishedAt } }));
        return withEtag(h, await getAdminProduct(db(request), id, request.server.app.storage), after.updatedAt);
      },
    }),
  ),
  {
    method: 'PUT',
    path: '/admin/products/{id}/variants',
    options: { ...write, payload: { maxBytes: 4 * 1024 * 1024 }, description: 'Replace the option and variant matrix; requires If-Match', tags: ['api', 'admin'], validate: { params: uuidParam('id'), payload: matrixBody } },
    handler: async (request, h) => {
      const id = productId(request);
      await audited(request, (tx) => replaceMatrix(tx, request.auth.credentials.adminId!, id, request.payload as MatrixInput, (updatedAt) => assertIfMatch(request, etagFor(updatedAt))), ({ changes }) => ({ action: 'product.variants.replace', resourceType: 'product', resourceId: id, after: { total: changes.length, sample: changes.slice(0, 50) } }));
      const detail = await getAdminProduct(db(request), id, request.server.app.storage);
      return withEtag(h, detail, detail.product.updatedAt);
    },
  },
  {
    method: 'POST',
    path: '/admin/media/upload-intents',
    options: {
      ...write,
      description: 'Short-lived signed upload URL for a product image',
      tags: ['api', 'admin'],
      validate: {
        payload: Joi.object({
          productId: Joi.string().uuid().required(),
          contentType: Joi.string().valid(...Object.keys(MEDIA_TYPES)).required(),
          sizeBytes: Joi.number().integer().min(1).max(MAX_UPLOAD_BYTES).required(),
        }),
      },
    },
    handler: async (request, h) => {
      const storage = request.server.app.storage;
      if (!storage) throw apiError(503, 'STORAGE_UNAVAILABLE', 'Media uploads are not configured.');
      return h.response(await createUploadIntent(db(request), storage, request.payload as { productId: string; contentType: string; sizeBytes: number })).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/admin/media/content-upload-intents',
    options: {
      ...guard('content:write'),
      description: 'Short-lived signed upload URL for a picture used in content (hero card, story circle, tile)',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ contentType: Joi.string().valid(...Object.keys(MEDIA_TYPES)).required(), sizeBytes: Joi.number().integer().min(1).max(MAX_UPLOAD_BYTES).required() }) },
    },
    handler: async (request, h) => {
      const storage = request.server.app.storage;
      if (!storage) throw apiError(503, 'STORAGE_UNAVAILABLE', 'Media uploads are not configured.');
      return h.response(createContentUploadIntent(storage, request.payload as { contentType: string; sizeBytes: number })).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/admin/products/{id}/media',
    options: {
      ...write,
      description: 'Attach an uploaded image to a product',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object({ objectKey: Joi.string().max(300).required(), ...mediaBody }) },
    },
    handler: async (request, h) => {
      const storage = request.server.app.storage;
      if (!storage) throw apiError(503, 'STORAGE_UNAVAILABLE', 'Media uploads are not configured.');
      const row = await audited(request, (tx) => finalizeMedia(tx, storage, productId(request), request.payload as MediaFields & { objectKey: string }), (row) => ({ action: 'product.media.add', resourceType: 'product', resourceId: productId(request), after: { mediaId: row.id, objectKey: row.objectKey } }));
      return h.response(row).code(201).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/products/{id}/media/{mediaId}',
    options: { ...write, description: 'Update alt text, order, cover or angle', tags: ['api', 'admin'], validate: { params: Joi.object({ id: Joi.string().uuid().required(), mediaId: Joi.string().uuid().required() }), payload: Joi.object(mediaBody).min(1) } },
    handler: async (request, h) => {
      const { mediaId } = request.params as { mediaId: string };
      const { after } = await audited(request, (tx) => updateMedia(tx, productId(request), mediaId, request.payload as MediaFields), () => ({ action: 'product.media.update', resourceType: 'product', resourceId: productId(request), after: { mediaId } }));
      return h.response(after).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'DELETE',
    path: '/admin/products/{id}/media/{mediaId}',
    options: { ...write, description: 'Remove an image from a product', tags: ['api', 'admin'], validate: { params: Joi.object({ id: Joi.string().uuid().required(), mediaId: Joi.string().uuid().required() }) } },
    handler: async (request, h) => {
      const { mediaId } = request.params as { mediaId: string };
      await audited(request, (tx) => deleteMedia(tx, productId(request), mediaId), (row) => ({ action: 'product.media.delete', resourceType: 'product', resourceId: productId(request), before: { mediaId, objectKey: row.objectKey } }));
      return h.response().code(204);
    },
  },

  // ------------------------------------------------------ categories & collections
  {
    method: 'GET',
    path: '/admin/categories',
    options: { ...read, description: 'All categories, including inactive', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response({ data: await listCategories(db(request)) }).header('Cache-Control', NO_STORE),
  },
  {
    method: 'POST',
    path: '/admin/categories',
    options: {
      ...write,
      description: 'Create a category',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ name: text(80).required(), slug: slugSchema, parentId: Joi.string().uuid().allow(null), sortOrder: Joi.number().integer().min(0).max(10_000), active: Joi.boolean() }) },
    },
    handler: async (request, h) => {
      const row = await audited(request, (tx) => createCategory(tx, request.payload as never), (row) => ({ action: 'category.create', resourceType: 'category', resourceId: row.id, after: row }));
      return h.response(row).code(201).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/categories/{id}',
    options: {
      ...write,
      description: 'Edit a category',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object({ name: text(80), slug: slugSchema, parentId: Joi.string().uuid().allow(null), sortOrder: Joi.number().integer().min(0).max(10_000), active: Joi.boolean() }).min(1) },
    },
    handler: async (request, h) => {
      const { after } = await audited(request, (tx) => updateCategory(tx, (request.params as { id: string }).id, request.payload as never), ({ before, after }) => ({ action: 'category.update', resourceType: 'category', resourceId: after.id, before, after }));
      return h.response(after).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/collections',
    options: { ...read, description: 'All collections, including inactive', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response({ data: await listCollections(db(request)) }).header('Cache-Control', NO_STORE),
  },
  {
    method: 'POST',
    path: '/admin/collections',
    options: {
      ...write,
      description: 'Create a collection',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ name: text(80).required(), slug: slugSchema, description: nullableText(1000), sortOrder: Joi.number().integer().min(0).max(10_000), active: Joi.boolean() }) },
    },
    handler: async (request, h) => {
      const row = await audited(request, (tx) => createCollection(tx, blankToNull(request.payload as never)), (row) => ({ action: 'collection.create', resourceType: 'collection', resourceId: row.id, after: row }));
      return h.response(row).code(201).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/collections/{id}',
    options: {
      ...write,
      description: 'Edit a collection',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object({ name: text(80), slug: slugSchema, description: nullableText(1000), sortOrder: Joi.number().integer().min(0).max(10_000), active: Joi.boolean() }).min(1) },
    },
    handler: async (request, h) => {
      const { after } = await audited(request, (tx) => updateCollection(tx, (request.params as { id: string }).id, blankToNull(request.payload as never)), ({ before, after }) => ({ action: 'collection.update', resourceType: 'collection', resourceId: after.id, before, after }));
      return h.response(after).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/collections/{id}/products',
    options: { ...read, description: 'The products in a collection, in display order', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => h.response({ data: await listCollectionProducts(db(request), (request.params as { id: string }).id) }).header('Cache-Control', NO_STORE),
  },
  {
    method: 'PUT',
    path: '/admin/collections/{id}/products',
    options: { ...write, description: 'Replace the products in a collection, in display order', tags: ['api', 'admin'], validate: { params: uuidParam('id'), payload: Joi.object({ productIds: ids.required() }) } },
    handler: async (request, h) => {
      const id = (request.params as { id: string }).id;
      const result = await audited(request, (tx) => setCollectionProducts(tx, id, (request.payload as { productIds: string[] }).productIds), (result) => ({ action: 'collection.products.set', resourceType: 'collection', resourceId: id, after: result }));
      return h.response(result).header('Cache-Control', NO_STORE);
    },
  },

  // ----------------------------------------------------------------- inventory
  {
    method: 'GET',
    path: '/admin/inventory',
    options: {
      ...guard('inventory:read'),
      description: 'Stock levels by variant, with low and out-of-stock filters',
      tags: ['api', 'admin'],
      validate: { query: Joi.object({ ...pageQuery, q: Joi.string().trim().min(1).max(100), filter: Joi.string().valid('low', 'out') }) },
    },
    handler: async (request, h) => h.response(await listInventory(db(request), request.query as never)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'PATCH',
    path: '/admin/inventory/{variantId}',
    options: {
      ...guard('inventory:write'),
      description: 'Adjust or recount stock; appends to the movement ledger',
      tags: ['api', 'admin'],
      validate: {
        params: uuidParam('variantId'),
        payload: Joi.object({
          mode: Joi.string().valid('adjust', 'set').required(),
          quantity: Joi.number().integer().min(-1_000_000).max(1_000_000).required(),
          reason: Joi.string().valid(...STOCK_REASONS).required(),
          reference: text(120),
          lowStockThreshold: Joi.number().integer().min(0).max(100_000).allow(null),
        }).custom((v, helpers) => (v.mode === 'set' && v.quantity < 0 ? helpers.error('any.invalid') : v), 'a counted quantity cannot be negative'),
      },
    },
    handler: async (request, h) => {
      const { variantId } = request.params as { variantId: string };
      const result = await audited(request, (tx) => changeStock(tx, request.auth.credentials.adminId!, variantId, request.payload as StockChange), (result) => ({ action: 'inventory.change', resourceType: 'variant', resourceId: variantId, before: result.before, after: { ...result.after, delta: result.delta, reason: (request.payload as StockChange).reason } }));
      return h.response(result.after).header('Cache-Control', NO_STORE);
    },
  },
];
