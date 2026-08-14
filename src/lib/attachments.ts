import {
  ATTACHMENT_JPEG_QUALITY,
  ATTACHMENT_MAX_DIMENSION,
  ATTACHMENT_TARGET_MAX_BYTES,
  type Attachment,
  type AttachmentEntity,
} from '@mb/shared';
import { apiCall } from '@/utils/api';

/**
 * Capturing a photo and getting it to the API at a size a branch phone can
 * actually upload.
 *
 * A modern phone camera hands back a 3–5 MB, 12-megapixel JPEG. Sending that
 * from a branch on a weak connection is a ten-second upload that frequently just
 * fails, and none of those pixels survive being looked at in a 200px-wide table
 * cell. Everything here exists to turn that frame into ~100–300 KB BEFORE it
 * leaves the device — the server's 5 MB limit is a backstop, not the working
 * size.
 *
 * All of it runs in the browser: `createImageBitmap`, `<canvas>` and
 * `HTMLCanvasElement.toBlob` have no server-side equivalent, and this app is a
 * static export with no server of its own anyway.
 */

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Quality steps tried in order until the encode fits the byte budget. */
const QUALITY_LADDER = [ATTACHMENT_JPEG_QUALITY, 0.55, 0.45, 0.35];

/**
 * Decode a captured file/frame, downscale it, and re-encode as JPEG.
 *
 * JPEG regardless of what came in: it is the only one of the three accepted
 * formats that a photograph compresses well in. A PNG straight off a screenshot
 * of a receipt can be several times larger than the JPEG of the same image, and
 * WebP encoding support in `toBlob` is still uneven across the Android WebViews
 * these branch devices run.
 *
 * EXIF is dropped by the canvas round-trip, which is a side effect worth
 * knowing: orientation is baked into the pixels here (browsers apply it during
 * decode), but any GPS tag in the original is discarded. The app records
 * position separately via the geofencing header — it does not rely on the photo.
 */
export async function compressImage(source: Blob): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, ATTACHMENT_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This device could not process the photo');
    // White rather than transparent: a PNG with an alpha channel would otherwise
    // composite onto black when flattened into JPEG, turning a white receipt
    // into an unreadable dark rectangle.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    let blob: Blob | null = null;
    for (const quality of QUALITY_LADDER) {
      blob = await toJpegBlob(canvas, quality);
      if (blob && blob.size <= ATTACHMENT_TARGET_MAX_BYTES) break;
    }
    if (!blob) throw new Error('This device could not process the photo');

    // Falling off the ladder without meeting the budget is fine — the last,
    // lowest-quality encode is still far below the API's limit. The budget is a
    // target, not a constraint; refusing the photo for missing it would be worse
    // than storing a slightly larger one.
    return { blob, width, height };
  } finally {
    // Frees the decoded frame immediately rather than waiting for GC. These are
    // multi-megabyte buffers and a form can take five of them.
    bitmap.close();
  }
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Upload one compressed photo, staged against `entity`.
 *
 * Returns the stored attachment; its `id` is what a create request then carries
 * in `attachmentIds`. Until the document is created the row belongs to nothing —
 * which is why dropping a photo from a form is purely a client-side act (see
 * PhotoCapture) and leaves a harmless orphan behind.
 *
 * Sent as multipart. `apiCall` deliberately omits the Content-Type header when
 * the body is FormData so the browser can set its own multipart boundary.
 */
export async function uploadAttachment(
  entity: AttachmentEntity,
  image: CompressedImage,
  token: string,
): Promise<Attachment> {
  const form = new FormData();
  form.append('entity', entity);
  form.append('width', String(image.width));
  form.append('height', String(image.height));
  // A filename is required by some multipart parsers; the server ignores it and
  // derives the extension from the sniffed mimetype instead.
  form.append('photo', image.blob, 'capture.jpg');

  const { attachment } = await apiCall<{ attachment: Attachment }>(
    '/api/attachments',
    { method: 'POST', body: form },
    token,
  );
  return attachment;
}

/** Compress and upload in one step — what every capture surface actually calls. */
export async function captureAndUpload(
  entity: AttachmentEntity,
  source: Blob,
  token: string,
): Promise<Attachment> {
  return uploadAttachment(entity, await compressImage(source), token);
}

/**
 * Whether this device can offer a live camera preview.
 *
 * `getUserMedia` needs a SECURE CONTEXT — https, or localhost during
 * development. On plain http (someone testing over a LAN IP) the API is simply
 * absent, so this returns false and the caller falls back to the file input,
 * which still opens the camera app on a phone.
 */
export function canUseLiveCamera(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Human-readable size, for the thumbnail's tooltip. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
