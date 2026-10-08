'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { PHOTO_UNPROCESSABLE, formatBytes, type LocalPhoto } from '@/lib/attachments';
import { PhotoSourceButtons } from '@/components/shared/PhotoCapture';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

/**
 * Choose ONE photo and keep it on the device until the form is submitted.
 *
 * The counterpart to PhotoCapture, which uploads the moment a picture is taken.
 * That is right for a form somebody is certain to submit; it is wrong where
 * cancelling is ordinary, because every cancelled form then leaves a file in
 * storage that belongs to nothing. Here the picture is compressed and previewed
 * locally and nothing touches the network — the surrounding form uploads it as
 * part of its own save, and a cancel costs nothing.
 *
 * The capture itself (camera app on a phone, live preview on a desktop, a
 * separate gallery input) is PhotoSourceButtons, shared with PhotoCapture.
 *
 * WHAT IS COMPRESSED TO WHAT is the caller's decision, passed as `prepare` — a
 * return photo and, say, a future expense attachment want different sizes, and
 * this component should not know either.
 *
 * The caller owns the LocalPhoto's lifetime: it holds the object URL, so it is
 * the one that must release it (`releaseLocalPhoto`) when the photo is replaced
 * or the form goes away.
 */
export function LocalPhotoCapture({
  value,
  onChange,
  prepare,
  label = 'Photo',
  required = false,
  disabled = false,
  error,
  hint,
}: {
  value: LocalPhoto | null;
  onChange: (next: LocalPhoto | null) => void;
  /** Validate + compress a picked file. Rejects with a user-facing message. */
  prepare: (source: Blob) => Promise<LocalPhoto>;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  /** Validation message from the surrounding form, shown under the buttons. */
  error?: string;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const onPicked = useCallback(
    async (source: Blob) => {
      setBusy(true);
      try {
        onChange(await prepare(source));
      } catch (err) {
        // The photo already chosen, if any, is left exactly as it was: a failed
        // retake must not cost the user the picture they had.
        toast.error(err instanceof Error ? err.message : PHOTO_UNPROCESSABLE);
      } finally {
        setBusy(false);
      }
    },
    [onChange, prepare],
  );

  const locked = disabled || busy;

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>

      <div className="flex items-start gap-3">
        {value && (
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            aria-label={`Preview ${label.toLowerCase()}`}
            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border transition-opacity hover:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- an object URL
                over a blob in memory; next/image has nothing to optimise and is
                unavailable in a static export anyway. */}
            <img src={value.previewUrl} alt={label} className="h-full w-full object-cover" />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin" />
              </span>
            )}
          </button>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <PhotoSourceButtons
              disabled={locked}
              busy={busy && !value}
              captureLabel={value ? 'Retake' : 'Camera'}
              galleryLabel={value ? 'Replace' : 'Gallery'}
              onPicked={(source) => void onPicked(source)}
            />
            {value && (
              <Button
                type="button"
                variant="ghost"
                disabled={locked}
                onClick={() => onChange(null)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Remove
              </Button>
            )}
          </div>

          {value && (
            // What will actually be stored. Shown because "is the photo small
            // enough?" is the question this whole path exists to answer, and the
            // number is the answer.
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatBytes(value.image.blob.size)} · {value.image.width}×{value.image.height}
            </p>
          )}
          {hint && !error && !value && <p className="text-xs text-muted-foreground">{hint}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>

      <Dialog open={previewing && value !== null} onOpenChange={setPreviewing}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          {value && (
            /* eslint-disable-next-line @next/next/no-img-element -- as above. */
            <img src={value.previewUrl} alt={label} className="max-h-[70vh] w-full rounded-lg object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
