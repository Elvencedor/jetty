import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { apiError, notFound } from '../../lib/errors.js';
import { withUrl, withUrls } from '../../modules/media/urls.js';
import { LIMITS } from '../../lib/rate-policies.js';
import { collectionExists, getCategoryTree, getProductBySlug } from '../../modules/catalog/detail.js';
import { getFacets, listProducts, PRODUCT_SORTS, suggestProducts, type ProductFilters, type ProductPage, type ProductSort } from '../../modules/catalog/listing.js';
import { db } from './shared.js';

const OPTION_FILTERS = ['texture', 'lace', 'length', 'density', 'colour'] as const;

const csvList = Joi.array().items(Joi.string().trim().lowercase().max(64)).single().max(20);
const slug = Joi.string().trim().lowercase().max(160).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const listQuery = {
  limit: Joi.number().integer().min(1).max(100).default(20),
  cursor: Joi.string().max(512),
  sort: Joi.string().valid(...PRODUCT_SORTS).default('recommended'),
  minPrice: Joi.number().integer().min(0),
  maxPrice: Joi.number().integer().min(0),
  inStock: Joi.boolean(),
  onOffer: Joi.boolean(),
  ...Object.fromEntries(OPTION_FILTERS.map((name) => [name, csvList])),
};

type ListQuery = {
  limit: number;
  cursor?: string;
  sort: ProductSort;
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onOffer?: boolean;
} & Partial<Record<(typeof OPTION_FILTERS)[number], string[]>>;

// "a,b" and repeated params are both accepted.
const splitValues = (values: string[]) => [...new Set(values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];

function toFilters(query: ListQuery, extra: Pick<ProductFilters, 'collectionSlug'> = {}): ProductFilters {
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
    throw apiError(422, 'VALIDATION_FAILED', 'minPrice must not exceed maxPrice.', [
      { path: 'minPrice', code: 'range.invalid' },
    ]);
  }
  const options: Record<string, string[]> = {};
  for (const name of OPTION_FILTERS) {
    const values = splitValues(query[name] ?? []);
    if (values.length > 0) options[name] = values;
  }
  return {
    options,
    ...(query.q ? { q: query.q } : {}),
    ...(query.category ? { categorySlug: query.category } : {}),
    ...(query.minPrice !== undefined ? { minPrice: query.minPrice } : {}),
    ...(query.maxPrice !== undefined ? { maxPrice: query.maxPrice } : {}),
    ...(query.inStock !== undefined ? { inStock: query.inStock } : {}),
    ...(query.onOffer !== undefined ? { onOffer: query.onOffer } : {}),
    ...extra,
  };
}

const withCardImages = (request: Request, page: ProductPage): ProductPage => ({
  ...page,
  data: page.data.map((card) => ({ ...card, image: withUrl(request.server.app.storage, card.image) })),
});

const publicCache = (h: ResponseToolkit, body: object) =>
  h.response(body).header('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

export const catalogRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/categories',
    options: { auth: false, description: 'Active category tree and collection entry points', tags: ['api', 'catalog'] },
    handler: async (request, h) => publicCache(h, { data: await getCategoryTree(db(request)) }),
  },
  {
    method: 'GET',
    path: '/collections/{slug}/products',
    options: {
      auth: false,
      description: 'Cursor page of products in a collection',
      tags: ['api', 'catalog'],
      validate: { params: Joi.object({ slug }), query: Joi.object(listQuery) },
    },
    handler: async (request, h) => {
      const { slug: collectionSlug } = request.params as { slug: string };
      const query = request.query as unknown as ListQuery;
      const database = db(request);
      if (!(await collectionExists(database, collectionSlug))) throw notFound('Collection not found.');
      const page = await listProducts(database, {
        filters: toFilters(query, { collectionSlug }),
        sort: query.sort,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
      });
      return publicCache(h, withCardImages(request, page));
    },
  },
  {
    method: 'GET',
    path: '/products',
    options: {
      auth: false,
      description: 'Search, filter, sort and paginate active products',
      tags: ['api', 'catalog'],
      validate: {
        query: Joi.object({
          ...listQuery,
          q: Joi.string().trim().min(1).max(100),
          category: slug,
        }),
      },
    },
    handler: async (request, h) => {
      const query = request.query as unknown as ListQuery;
      const page = await listProducts(db(request), {
        filters: toFilters(query),
        sort: query.sort,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
      });
      return publicCache(h, withCardImages(request, page));
    },
  },
  {
    method: 'GET',
    path: '/products/facets',
    options: {
      auth: false,
      plugins: { rateLimit: { ip: [LIMITS.facets] } },
      description: 'Filter options, counts and price range for the current selection',
      tags: ['api', 'catalog'],
      validate: {
        query: Joi.object({
          ...Object.fromEntries(Object.entries(listQuery).filter(([k]) => !['limit', 'cursor', 'sort'].includes(k))),
          q: Joi.string().trim().min(1).max(100),
          category: slug,
          collection: slug,
        }),
      },
    },
    handler: async (request, h) => {
      const query = request.query as unknown as ListQuery & { collection?: string };
      const facets = await getFacets(db(request), toFilters(query, query.collection ? { collectionSlug: query.collection } : {}));
      return publicCache(h, { data: facets });
    },
  },
  {
    method: 'GET',
    path: '/products/suggestions',
    options: {
      auth: false,
      plugins: { rateLimit: { ip: [LIMITS.suggest] } },
      description: 'Type-ahead product suggestions',
      tags: ['api', 'catalog'],
      validate: { query: Joi.object({ q: Joi.string().trim().min(2).max(60).required(), limit: Joi.number().integer().min(1).max(10).default(6) }) },
    },
    handler: async (request, h) => {
      const { q, limit } = request.query as { q: string; limit: number };
      const suggestions = await suggestProducts(db(request), q, limit);
      return publicCache(h, { data: suggestions.map((x) => ({ ...x, image: withUrl(request.server.app.storage, x.image) })) });
    },
  },
  {
    method: 'GET',
    path: '/products/{slug}',
    options: {
      auth: false,
      description: 'Product detail with options, variants, media, availability and rating',
      tags: ['api', 'catalog'],
      validate: { params: Joi.object({ slug }) },
    },
    handler: async (request, h) => {
      const product = await getProductBySlug(db(request), (request.params as { slug: string }).slug);
      if (!product) throw notFound('Product not found.');
      return publicCache(h, { data: { ...product, media: withUrls(request.server.app.storage, product.media) } });
    },
  },
];
