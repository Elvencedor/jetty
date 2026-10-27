import type { Env } from '../config/env.js';
import type { Logger } from './logger.js';

export type StorefrontTag = 'settings' | 'home' | 'catalog';

/**
 * Tells the storefront that cached data has changed, so an admin's edit shows up at once instead of when the cache
 * next expires. Best effort: it never throws and never delays the admin (a failure is logged; the storefront's own
 * cache lifetime is the fallback). Does nothing unless the storefront URL and shared secret are configured.
 */
export async function revalidateStorefront(env: Pick<Env, 'STOREFRONT_REVALIDATE_URL' | 'REVALIDATE_SECRET'>, log: Pick<Logger, 'warn'>, tags: StorefrontTag[], fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!env.STOREFRONT_REVALIDATE_URL || !env.REVALIDATE_SECRET) return;
  try {
    const res = await fetchImpl(env.STOREFRONT_REVALIDATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.REVALIDATE_SECRET },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) log.warn('storefront revalidation was refused', { status: res.status, tags });
  } catch (err) {
    log.warn('storefront revalidation failed', { error: err instanceof Error ? err.message : String(err), tags });
  }
}
