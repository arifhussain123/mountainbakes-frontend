import {
  ATTACHMENT_JPEG_QUALITY,
  ATTACHMENT_STORED_DIMENSION,
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

/**
 * Quality steps tried in order until the encode meets the byte budget.
 *
 * Only quality moves. The dimensions are fixed at ATTACHMENT_STORED_DIMENSION so
 * that every photo in the database is the same size whichever phone took it,
 * and because text survives losing quality far better than it survives losing
 * pixels — shrinking a receipt to make it fit defeats the point of keeping it.
 */
const QUALITY_LADDER = [ATTACHMENT_JPEG_QUALITY, 0.72, 0.62, 0.5];

/**
 * WebP encodes photographs roughly a third smaller than JPEG at the same visible
 * quality, which is what buys the jump from 1280px to 2000px inside the same
 * budget. Support in `toBlob` is still uneven across the Android WebViews these
 * branch devices run, and an unsupported browser does not fail — it silently
 * hands back a PNG. So the probe checks the type it actually got, once.
 */
let webpEncodes: boolean | null = null;
async function supportsWebp(): Promise<boolean> {
  if (webpEncodes !== null) return webpEncodes;
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const blob = await new Promise<Blob | null>((r) => probe.toBlob(r, 'image/webp', 0.8));
  webpEncodes = blob?.type === 'image/webp';
  return webpEncodes;
}

/**
 * Decode a captured file/frame, normalise it to one stored size, and re-encode.
 *
 * NORMALISED, not merely capped: every capture lands at
 * ATTACHMENT_STORED_DIMENSION on its longest edge, so the same receipt shot on a
 * 48 MP flagship and a tired branch handset occupies the same space and reads
 * the same in the gallery. It is never upscaled to get there — enlarging a small
 * gallery image invents no detail and costs real bytes.
 *
 * WebP when the browser truly encodes it, JPEG otherwise. Both beat PNG for a
 * photograph by a wide margin: a PNG of a receipt can be several times the size
 * of the same image as JPEG.
 *
 * EXIF is dropped by the canvas round-trip, which is a side effect worth
 * knowing: orientation is baked into the pixels here (browsers apply it during
 * decode), but any GPS tag in the original is discarded. The app records
 * position separately via the geofencing header — it does not rely on the photo.
 */
export async function compressImage(source: Blob): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(source);
  try {
    // min(1, …) is what makes this a cap rather than a resize: an image already
    // under the stored size keeps its own dimensions.
    const scale = Math.min(1, ATTACHMENT_STORED_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This device could not process the photo');

    // The single biggest readability win here, and it costs nothing. The default
    // is 'low', which point-samples: dropping a 4000px frame to 2000px that way
    // drops every other pixel, and thin printed strokes disappear between the
    // samples. 'high' resamples across the pixels it discards.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // White rather than transparent: a PNG with an alpha channel would otherwise
    // composite onto black when flattened into JPEG, turning a white receipt
    // into an unreadable dark rectangle.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const type = (await supportsWebp()) ? 'image/webp' : 'image/jpeg';

    let blob: Blob | null = null;
    for (const quality of QUALITY_LADDER) {
      blob = await toBlob(canvas, type, quality);
      if (blob && blob.size <= ATTACHMENT_TARGET_MAX_BYTES) break;
    }
    if (!blob) throw new Error('This device could not process the photo');

    // Falling off the ladder without meeting the budget is fine — the last
    // encode is still far below the API's limit. The budget is a target, not a
    // constraint; refusing the photo for missing it, or shrinking it until it
    // fits, would both be worse than storing one slightly larger file.
    return { blob, width, height };
  } finally {
    // Frees the decoded frame immediately rather than waiting for GC. These are
    // multi-megabyte buffers and a form can take five of them.
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
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
  // derives the extension from the sniffed mimetype instead. Named after what
  // the encoder actually produced anyway, so a captured request is not
  // misleading to read.
  form.append('photo', image.blob, image.blob.type === 'image/webp' ? 'capture.webp' : 'capture.jpg');

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

/**
 * Whether "Take photo" should hand off to the device's own camera app instead of
 * the in-app preview.
 *
 * On a phone it should, always. `getUserMedia` returns a VIDEO stream, and a
 * grabbed video frame is not a photograph: the browser picks a modest default
 * resolution, and none of the still-capture pipeline — the multi-frame stacking,
 * the sharpening, the real autofocus pass — ever runs. The camera app produces a
 * full-resolution still with all of it. That difference is the whole reason a
 * captured receipt came out unreadable.
 *
 * A coarse pointer is the signal: phones and tablets, where `<input capture>` is
 * honoured. Desktops keep the live preview, because there `capture` is ignored
 * and silently degrades to a file picker — no capture path at all.
 */
export function prefersDeviceCamera(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Subscribe form of the above, for `useSyncExternalStore`.
 *
 * That hook rather than state-in-an-effect because this app prerenders: the
 * server snapshot is a flat `false`, so the markup React builds during the build
 * and the markup it hydrates into agree, and the real answer arrives without a
 * mismatch. The change listener covers a convertible laptop switching between
 * touch and trackpad mid-session.
 */
export function subscribeDeviceCamera(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia('(pointer: coarse)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Human-readable size, for the thumbnail's tooltip. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
