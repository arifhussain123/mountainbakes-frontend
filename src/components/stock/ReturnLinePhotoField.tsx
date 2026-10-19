'use client';

import { AlertCircle, Loader2, RotateCw, TriangleAlert, X } from 'lucide-react';
import { PhotoSourceButtons } from '@/components/shared/PhotoCapture';
import { Button } from '@/components/ui/button';
import type { LinePhoto } from './useReturnLinePhotos';

/**
 * The photo control on ONE Return Items line: take or pick a picture, watch it
 * upload, look at it, retake it, or take it away.
 *
 * Purely presentational — the state and every side effect (compressing,
 * uploading, discarding) live in useReturnLinePhotos, keyed by the row. This
 * only draws what the line's photo is doing and hands presses back up.
 *
 * Four states, each with its own way forward on THIS line only:
 *   none      → Camera / Gallery (Upload on a desktop), with "Photo required"
 *               once the line has a quantity;
 *   uploading → the thumbnail with a progress bar; Retake still works and
 *               cancels this upload;
 *   uploaded  → the thumbnail (opens full size), Retake / Replace, remove;
 *   failed    → the thumbnail, the reason, and Retry — the same picture is
 *               sent again, so a dropped connection costs no retake.
 */
export function ReturnLinePhotoField({
  photo,
  preparing,
  subject,
  required,
  disabled,
  onPick,
  onRetry,
  onRemove,
  onView,
}: {
  photo: LinePhoto | undefined;
  /** The picked file is still being compressed. */
  preparing: boolean;
  /** What the photo is OF — the product name, or "item 2" before one is chosen. */
  subject: string;
  /** The line has a quantity, so a missing photo blocks Save — say so. */
  required: boolean;
  disabled: boolean;
  onPick: (source: Blob) => void;
  onRetry: () => void;
  onRemove: () => void;
  onView: () => void;
}) {
  const label = `Photo of returned ${subject}`;
  const status = photo?.status;
  const pct = Math.round((photo?.progress ?? 0) * 100);

  return (
    <div data-photo-control className="flex min-w-0 items-start gap-2">
      {/* Phone only: the line labels its own photo, with the required marker.
          On a desktop the column heading does both. */}
      <span className="mt-2 shrink-0 text-xs text-muted-foreground md:hidden">
        Photo
        <span className="ml-0.5 text-destructive" aria-hidden>
          *
        </span>
      </span>

      {photo && (
        <button
          type="button"
          onClick={onView}
          aria-label={label}
          title={label}
          className="relative size-10 shrink-0 overflow-hidden rounded-md border transition-opacity hover:opacity-80 md:size-9"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- an object URL
              over a blob in memory; next/image has nothing to optimise and is
              unavailable in a static export anyway. */}
          <img src={photo.local.previewUrl} alt={label} className="h-full w-full object-cover" />
          {(status === 'uploading' || preparing) && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          )}
          {status === 'failed' && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60 text-destructive">
              <TriangleAlert className="h-4 w-4" />
            </span>
          )}
        </button>
      )}
      {!photo && preparing && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted md:size-9">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="sr-only">Preparing photo…</span>
        </span>
      )}

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {status === 'failed' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onRetry}
              aria-label={`Retry: ${label}`}
            >
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Retry
            </Button>
          ) : (
            <PhotoSourceButtons
              size="sm"
              disabled={disabled || preparing}
              busy={preparing && !photo}
              captureLabel={photo ? 'Retake' : 'Camera'}
              galleryLabel={photo ? 'Replace' : undefined}
              subject={`returned ${subject}`}
              onPicked={onPick}
            />
          )}
          {photo && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={onRemove}
              aria-label={`Remove photo of ${subject}`}
              title="Remove photo"
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {status === 'uploading' && (
          <div className="flex items-center gap-2">
            <div
              role="progressbar"
              aria-label={`Uploading photo of ${subject}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">Uploading {pct}%</span>
          </div>
        )}
        {status === 'failed' && (
          <p role="alert" className="text-xs font-medium text-destructive">
            Upload failed. {photo?.error}
          </p>
        )}
        {/* Text, not colour alone: "Photo required" is read out and printed,
            and it is what Save scrolls to. */}
        {!photo && !preparing && required && (
          <p className="flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> Photo required
          </p>
        )}
      </div>
    </div>
  );
}
