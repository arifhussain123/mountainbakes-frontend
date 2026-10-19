'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Attachment } from '@mb/shared';
import {
  PHOTO_UNPROCESSABLE,
  discardAttachment,
  prepareReturnPhoto,
  releaseLocalPhoto,
  uploadAttachmentWithProgress,
  type LocalPhoto,
} from '@/lib/attachments';
import { ApiError } from '@/utils/api';

/**
 * The photo of ONE returned product, as the Return Items form holds it.
 *
 * `local` is kept for the whole life of the line, uploaded or not: it is the
 * thumbnail (an object URL, no network), and it is what Retry sends again —
 * after a dropped connection, or after the server said the staged upload is no
 * longer usable (`attachment_unavailable`) — without asking for a new picture.
 */
export interface LinePhoto {
  local: LocalPhoto;
  status: 'uploading' | 'uploaded' | 'failed';
  /** 0–1 while uploading. */
  progress: number;
  /** The stored attachment once uploaded; its `id` is the line's `attachmentId`. */
  attachment: Attachment | null;
  /** Why the last upload failed — shown on that line only. */
  error: string | null;
}

/** What the hook needs from the outside world. Injected so tests can stand in for it. */
export interface LinePhotoDeps {
  prepare: (source: Blob) => Promise<LocalPhoto>;
  upload: typeof uploadAttachmentWithProgress;
  discard: (id: string, token: string) => Promise<void>;
}

const DEFAULT_DEPS: LinePhotoDeps = {
  prepare: prepareReturnPhoto,
  upload: uploadAttachmentWithProgress,
  discard: discardAttachment,
};

/**
 * Bookkeeping that must not wait for a render: which attempt is current, and
 * the controller that cancels it. A line's upload that finishes after the line
 * was retaken, removed or the form closed is recognised by its attempt number
 * and thrown away (its staged upload discarded) instead of landing on the
 * wrong photo.
 */
interface LineBook {
  /** Bumped by every upload start and every drop. */
  attempt: number;
  /**
   * Bumped by every pick. Separate from `attempt` so compressing a retake does
   * not orphan the upload of the photo still on screen — if the retake's file
   * turns out unusable, that photo must carry on as it was.
   */
  pickSeq: number;
  controller: AbortController | null;
  photo: LinePhoto | null;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function uploadErrorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 0) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? "You're offline — retry when connected."
      : 'Could not reach the server.';
  }
  // 415 (a HEIC the browser passed through untouched) and 413 are both "this
  // file will not do", which is a new picture, not a retry.
  if (err instanceof ApiError && (err.status === 415 || err.status === 413)) return PHOTO_UNPROCESSABLE;
  return err instanceof Error && err.message ? err.message : 'Upload failed.';
}

/**
 * One photo per return line, uploaded the moment it is taken.
 *
 * WHY UPLOAD AT ONCE, when the single return photo used to wait for Save: with
 * a photo per product, a five-product return is five uploads, and doing them
 * all behind the Save button made Save the slowest, most failure-prone press in
 * the shop. Uploading each as it is taken spreads that out, shows its progress
 * on its own row, and lets one bad upload be retried without touching the
 * others. Save then sends only ids.
 *
 * The cost is uploads that end up belonging to nothing — a photo retaken,
 * removed, or left behind by a cancelled form. Every one of those paths
 * discards its staged upload here (best-effort, DELETE /api/attachments/:id),
 * and the API sweeps whatever this misses after RETURN_PHOTO_STAGED_TTL_HOURS.
 *
 * Keyed by the form's stable ROW id, never by index: deleting row 2 must not
 * hand row 3's photo to the row that slides up into its place.
 */
export function useReturnLinePhotos(token: string | null | undefined, deps: LinePhotoDeps = DEFAULT_DEPS) {
  const [photos, setPhotos] = useState<Record<string, LinePhoto>>({});
  /** Rows whose picked file is still being compressed. */
  const [preparing, setPreparing] = useState<Record<string, true>>({});
  const books = useRef(new Map<string, LineBook>());
  const depsRef = useRef(deps);
  const tokenRef = useRef(token);
  useEffect(() => {
    depsRef.current = deps;
    tokenRef.current = token;
  });

  const book = useCallback((rowId: string): LineBook => {
    let b = books.current.get(rowId);
    if (!b) {
      b = { attempt: 0, pickSeq: 0, controller: null, photo: null };
      books.current.set(rowId, b);
    }
    return b;
  }, []);

  /** Write a line's photo to both the bookkeeping and render state. */
  const commit = useCallback((rowId: string, photo: LinePhoto | null) => {
    const b = books.current.get(rowId);
    if (b) b.photo = photo;
    setPhotos((all) => {
      const next = { ...all };
      if (photo) next[rowId] = photo;
      else delete next[rowId];
      return next;
    });
  }, []);

  const setPreparingFor = useCallback((rowId: string, on: boolean) => {
    setPreparing((all) => {
      if (on === Boolean(all[rowId])) return all;
      const next = { ...all };
      if (on) next[rowId] = true;
      else delete next[rowId];
      return next;
    });
  }, []);

  /**
   * Let go of whatever a line holds: cancel its upload, discard its staged
   * attachment (unless `keepBound` says the server has already bound it), and
   * free the preview. Bumps the attempt so anything still in flight for it is
   * recognised as stale when it lands.
   */
  const drop = useCallback((rowId: string, keepBound?: ReadonlySet<string>) => {
    const b = books.current.get(rowId);
    if (!b) return;
    b.attempt += 1;
    b.controller?.abort();
    b.controller = null;
    const id = b.photo?.attachment?.id;
    if (id && !keepBound?.has(id) && tokenRef.current) void depsRef.current.discard(id, tokenRef.current);
    releaseLocalPhoto(b.photo?.local);
    b.photo = null;
  }, []);

  const startUpload = useCallback(
    (rowId: string) => {
      const b = books.current.get(rowId);
      const local = b?.photo?.local;
      const authToken = tokenRef.current;
      if (!b || !local) return;
      if (!authToken) {
        commit(rowId, { local, status: 'failed', progress: 0, attachment: null, error: 'Your session has expired. Sign in again.' });
        return;
      }

      const attempt = b.attempt;
      const controller = new AbortController();
      b.controller = controller;
      commit(rowId, { local, status: 'uploading', progress: 0, attachment: null, error: null });

      let lastShown = 0;
      depsRef.current
        .upload('branch_return', local.image, authToken, {
          signal: controller.signal,
          onProgress: (fraction) => {
            // Whole percents only — a progress event per network packet is a
            // re-render per packet otherwise.
            const pct = Math.floor(fraction * 100);
            if (pct === lastShown || b.attempt !== attempt) return;
            lastShown = pct;
            commit(rowId, { local, status: 'uploading', progress: pct / 100, attachment: null, error: null });
          },
        })
        .then((attachment) => {
          if (b.attempt !== attempt) {
            // Retaken, removed or closed while this was in the air: it belongs
            // to nothing now.
            void depsRef.current.discard(attachment.id, authToken);
            return;
          }
          b.controller = null;
          commit(rowId, { local, status: 'uploaded', progress: 1, attachment, error: null });
        })
        .catch((err: unknown) => {
          if (isAbort(err) || b.attempt !== attempt) return;
          b.controller = null;
          commit(rowId, { local, status: 'failed', progress: 0, attachment: null, error: uploadErrorText(err) });
        });
    },
    [commit],
  );

  /**
   * A picture was taken or chosen for a line: compress it, replace whatever the
   * line had, and start uploading it.
   *
   * The old photo stays on screen until the new one is ready — a retake whose
   * file turns out unusable must not cost the user the picture they had.
   */
  const pick = useCallback(
    async (rowId: string, source: Blob) => {
      const b = book(rowId);
      const seq = ++b.pickSeq;
      setPreparingFor(rowId, true);
      let local: LocalPhoto;
      try {
        local = await depsRef.current.prepare(source);
      } catch (err) {
        if (b.pickSeq === seq) {
          setPreparingFor(rowId, false);
          toast.error(err instanceof Error ? err.message : PHOTO_UNPROCESSABLE);
        }
        return;
      }
      if (b.pickSeq !== seq || books.current.get(rowId) !== b) {
        // The line went away (or was picked again) while this compressed.
        releaseLocalPhoto(local);
        return;
      }
      setPreparingFor(rowId, false);
      drop(rowId);
      b.photo = { local, status: 'uploading', progress: 0, attachment: null, error: null };
      startUpload(rowId);
    },
    [book, drop, setPreparingFor, startUpload],
  );

  /** Upload a failed line's photo again — the same picture, no retake needed. */
  const retry = useCallback(
    (rowId: string) => {
      const b = books.current.get(rowId);
      if (!b?.photo || b.photo.status !== 'failed') return;
      b.attempt += 1;
      startUpload(rowId);
    },
    [startUpload],
  );

  /** Take a line's photo away (its row was deleted, or the photo removed). */
  const remove = useCallback(
    (rowId: string) => {
      drop(rowId);
      books.current.delete(rowId);
      commit(rowId, null);
      setPreparingFor(rowId, false);
    },
    [commit, drop, setPreparingFor],
  );

  /**
   * The server answered `attachment_unavailable` for these ids: the staged
   * uploads were swept (or never bound). Those lines go back to "failed" with
   * the picture still held, so Retry uploads it afresh.
   */
  const markUnavailable = useCallback(
    (attachmentIds: readonly string[]) => {
      const gone = new Set(attachmentIds);
      for (const [rowId, b] of books.current) {
        const p = b.photo;
        if (p?.attachment && gone.has(p.attachment.id)) {
          commit(rowId, { ...p, status: 'failed', progress: 0, attachment: null, error: 'Photo expired — retry or retake.' });
        }
      }
    },
    [commit],
  );

  /**
   * Empty every line. Staged uploads are discarded EXCEPT the ids in `keep` —
   * the ones a just-saved return now cites, which the server has bound and
   * which must not be touched (the API would refuse anyway; this does not ask).
   */
  const clear = useCallback(
    (keep?: ReadonlySet<string>) => {
      for (const rowId of [...books.current.keys()]) drop(rowId, keep);
      books.current.clear();
      setPhotos({});
      setPreparing({});
    },
    [drop],
  );

  // Leaving the page with the form open: the same tidy-up as a cancel.
  useEffect(() => () => clear(), [clear]);

  return { photos, preparing, pick, retry, remove, markUnavailable, clear };
}
