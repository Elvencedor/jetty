import type { ObjectStorage } from './storage.js';

type Keyed = { objectKey: string };

/** Adds a time-limited `url` to an image reference. Without configured storage the url is null rather than a broken link. */
export const withUrl = <T extends Keyed>(storage: ObjectStorage | undefined, image: T | null | undefined): (T & { url: string | null }) | null =>
  image ? { ...image, url: storage ? storage.urlFor(image.objectKey) : null } : null;

export const withUrls = <T extends Keyed>(storage: ObjectStorage | undefined, images: T[]) => images.map((i) => withUrl(storage, i)!);

/** Adds image URLs to the lines of a priced cart (quote or checkout response). */
export function withLineImages<T extends { lines: { image: Keyed | null }[] }>(storage: ObjectStorage | undefined, cart: T): T {
  return { ...cart, lines: cart.lines.map((l) => ({ ...l, image: withUrl(storage, l.image) })) };
}
