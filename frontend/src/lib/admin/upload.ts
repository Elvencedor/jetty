import { attachMedia, createUploadIntent } from "@/lib/api/admin-catalog";

/** What the API accepts, and the most it will take (it also checks). */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The longest side photos are shrunk to before upload: sharp on any screen, a fraction of a phone camera's size. */
export const MAX_SIDE = 2000;
const WEBP_QUALITY = 0.85;

/** Why a file cannot be uploaded at all, or null if it can be tried. */
export function checkFile(file: Pick<File, "type" | "size" | "name">): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return `${file.name} isn't a JPEG, PNG, WebP or AVIF image.`;
  // Anything this big will not fit after shrinking either; saying so now saves the wait.
  if (file.size > 50 * 1024 * 1024) return `${file.name} is too large. Photos can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** The size an image shrinks to so its longest side is at most `max` (never enlarged). */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type Prepared = { blob: Blob; contentType: string; width: number | null; height: number | null };

/**
 * Shrinks a photo and re-encodes it as WebP in the browser. If the browser cannot (no canvas support, a broken
 * file), the original goes up untouched, with unknown dimensions: the upload still works, only larger.
 */
export async function prepareImage(file: File): Promise<Prepared> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    if (!blob || blob.type !== "image/webp") throw new Error("no webp");
    return { blob, contentType: "image/webp", width, height };
  } catch {
    return { blob: file, contentType: file.type, width: null, height: null };
  }
}

/** PUTs a file to a presigned URL, reporting progress (fetch cannot). */
export function putWithProgress(url: string, headers: Record<string, string>, body: Blob, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      // The browser sets the length itself, and refuses to let a script do it.
      if (name.toLowerCase() !== "content-length") xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The storage service refused the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(body);
  });
}

/** The whole trip for one photo: shrink, ask for a signed address, upload, then register it on the product. */
export async function uploadProductImage(productId: string, file: File, onProgress: (fraction: number) => void) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const prepared = await prepareImage(file);
  if (prepared.blob.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is still over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB after shrinking. Use a smaller photo.`);
  const intent = await createUploadIntent({ productId, contentType: prepared.contentType, sizeBytes: prepared.blob.size });
  await putWithProgress(intent.upload.url, intent.upload.headers, prepared.blob, onProgress);
  return attachMedia(productId, { objectKey: intent.objectKey, width: prepared.width, height: prepared.height });
}
