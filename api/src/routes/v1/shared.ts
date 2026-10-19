import type { Request } from '@hapi/hapi';
import type { Db } from '../../db/client.js';
import { apiError } from '../../lib/errors.js';

/** The request's database, or a 503 when the service runs without one (e.g. some tests). */
export function db(request: Request): Db {
  const database = request.server.app.database;
  if (!database) throw apiError(503, 'DATABASE_UNAVAILABLE', 'The service is temporarily unavailable.');
  return database.db;
}

/** For responses that depend on live stock, prices or the caller. */
export const NO_STORE = 'no-store';
