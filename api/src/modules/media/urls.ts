import type { ObjectStorage } from './storage.js';

type Keyed = { objectKey: string };

/** Adds a time-limited `url` to an image reference. Without configured storage the url is null rather than a broken link. */
export const withUrl = <T extends Keyed>(storage: ObjectStorage | undefined, image: T | null | undefined): (T & { url: string | null }) | null =>
  image ? { ...image, url: storage ? storage.presignDownload(image.objectKey) : null } : null;

export const withUrls = <T extends Keyed>(storage: ObjectStorage | undefined, images: T[]) => images.map((i) => withUrl(storage, i)!);
