import { createHash, createHmac } from 'node:crypto';

export type UploadIntent = {
  method: 'PUT';
  url: string;
  /** The browser must send exactly these headers; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
};

export type StoredObject = { sizeBytes: number; contentType: string | null };

export interface ObjectStorage {
  presignUpload(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number; now?: Date }): UploadIntent;
  /**
   * Time-limited read URL for a private object. Signed at the start of the current hour and valid for two, so the
   * URL for a given key is identical for an hour at a time and browsers and CDNs can cache it.
   */
  presignDownload(key: string, now?: Date): string;
  /** Server-side existence/size check used to finalise an upload; null when the object is not there. */
  head(key: string): Promise<StoredObject | null>;
}

export type S3Options = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string; fetch?: typeof fetch };

const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (key: string) => key.split('/').map(encode).join('/');

/** S3-compatible storage (Cloudflare R2, MinIO, AWS) using path-style addressing and SigV4 query signing. */
export class S3Storage implements ObjectStorage {
  private readonly fetchImpl: typeof fetch;
  private readonly host: string;
  private readonly origin: string;

  constructor(private readonly o: S3Options) {
    const url = new URL(o.endpoint);
    this.host = url.host;
    this.origin = `${url.protocol}//${url.host}`;
    this.fetchImpl = o.fetch ?? fetch;
  }

  private sign(method: string, key: string, headers: Record<string, string>, expiresInSeconds: number, now: Date): string {
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const day = amzDate.slice(0, 8);
    const scope = `${day}/${this.o.region}/s3/aws4_request`;
    const all: Record<string, string> = { host: this.host, ...headers };
    const names = Object.keys(all).sort();
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.o.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': names.join(';'),
    };
    const canonicalQuery = Object.keys(query).sort().map((k) => `${encode(k)}=${encode(query[k]!)}`).join('&');
    const path = `/${encode(this.o.bucket)}/${encodePath(key)}`;
    const canonical = [method, path, canonicalQuery, names.map((n) => `${n}:${all[n]!.trim()}\n`).join(''), names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.o.secretAccessKey}`, day), this.o.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
    return `${this.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  presignUpload({ key, contentType, sizeBytes, expiresInSeconds, now = new Date() }: Parameters<ObjectStorage['presignUpload']>[0]): UploadIntent {
    // Content type and length are signed, so the bucket rejects an upload that differs from what was validated.
    const headers = { 'content-length': String(sizeBytes), 'content-type': contentType };
    return {
      method: 'PUT',
      url: this.sign('PUT', key, headers, expiresInSeconds, now),
      headers: { 'Content-Length': headers['content-length'], 'Content-Type': contentType },
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    };
  }

  presignDownload(key: string, now: Date = new Date()): string {
    const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    return this.sign('GET', key, {}, 2 * 3600, hour);
  }

  async head(key: string): Promise<StoredObject | null> {
    const res = await this.fetchImpl(this.sign('HEAD', key, {}, 60, new Date()), { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Object storage responded ${res.status}`);
    return { sizeBytes: Number(res.headers.get('content-length') ?? 0), contentType: res.headers.get('content-type') };
  }
}
