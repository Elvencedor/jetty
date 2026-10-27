import type { ObjectStorage, StoredObject, UploadIntent } from '../modules/media/storage.js';

/** In-memory object store: tests "upload" by calling `put`. */
export class FakeStorage implements ObjectStorage {
  objects = new Map<string, StoredObject>();
  presigned: { key: string; contentType: string; sizeBytes: number }[] = [];

  presignUpload(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }): UploadIntent {
    this.presigned.push({ key: input.key, contentType: input.contentType, sizeBytes: input.sizeBytes });
    return { method: 'PUT', url: `https://storage.test/${input.key}?sig=x`, headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.sizeBytes) }, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() };
  }
  urlFor(key: string): string {
    return `https://storage.test/${key}?download=1`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  put(key: string, sizeBytes = 1000, contentType = 'image/jpeg') {
    this.objects.set(key, { sizeBytes, contentType });
  }
}
