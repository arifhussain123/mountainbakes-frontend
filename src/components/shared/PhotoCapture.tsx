'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, ImageUp, Loader2, X } from 'lucide-react';
import { ATTACHMENT_MAX_PER_ENTITY, type Attachment, type AttachmentEntity } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { canUseLiveCamera, captureAndUpload, formatBytes } from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

/**
 * Capture a photo, compress it, upload it, and hand the caller back the stored
 * attachments.
 *
 * TWO CAPTURE PATHS, and both are needed:
 *
 *   * **Live camera** (`getUserMedia` + `<video>`) — a preview inside the app
 *     with a shutter button. This is the only path that works on a DESKTOP
 *     browser, where `<input capture>` is ignored and silently degrades to a
 *     file picker. It needs a secure context, so it is absent over plain http.
 *   * **File input with `capture="environment"`** — on a phone this opens the
 *     native camera app directly. It is the fallback when `getUserMedia` is
 *     unavailable or the user denies permission, and it is also the only way to
 *     attach a photo already in the gallery.
 *
 * Offering only the first would break http/LAN testing and permission-denied
 * devices; offering only the second would mean no desktop user could ever
 * capture, only browse.
 *
 * REMOVING a photo is purely local. An uploaded attachment is immutable and
 * cannot be deleted (migration 67 — a document's supporting photo is part of its
 * audit trail), so dropping one here simply leaves it unbound: an orphan row
 * belonging to nothing, which no screen ever reads. That is deliberate. The
 * alternative — a delete endpoint — would also let a bound receipt be destroyed.
 */
export function PhotoCapture({
  entity,
  value,
  onChange,
  label = 'Photo',
  required = false,
  max = ATTACHMENT_MAX_PER_ENTITY,
  disabled = false,
  error,
  hint,
}: {
  entity: AttachmentEntity;
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  label?: string;
  required?: boolean;
  max?: number;
  disabled?: boolean;
  /** Validation message from the surrounding form, shown under the buttons. */
  error?: string;
  hint?: string;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const atLimit = value.length >= max;
  const canCapture = !disabled && !busy && !atLimit;

  const store = useCallback(
    async (source: Blob) => {
      if (!token) {
        toast.error('Your session has expired. Sign in again.');
        return;
      }
      setBusy(true);
      try {
        const attachment = await captureAndUpload(entity, source, token);
        onChange([...value, attachment]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save that photo');
      } finally {
        setBusy(false);
      }
    },
    [entity, onChange, token, value],
  );

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((a) => (
            <figure key={a.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image
                  optimisation is unavailable in a static export, and the src is a
                  short-lived signed URL from a private bucket rather than an
                  asset this app owns. */}
              <img
                src={a.url}
                alt={label}
                title={formatBytes(a.sizeBytes)}
                className="h-20 w-20 rounded-lg border object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => onChange(value.filter((v) => v.id !== a.id))}
                  className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canUseLiveCamera() && (
          <Button type="button" variant="outline" disabled={!canCapture} onClick={() => setCameraOpen(true)}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            Take photo
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!canCapture}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageUp className="mr-1.5 h-4 w-4" />
          {canUseLiveCamera() ? 'Upload' : 'Camera or gallery'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          // Ignored by desktop browsers (they show a file picker instead), which
          // is why the live-camera button above exists.
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first: picking the SAME file twice fires no change event
            // otherwise, so a retake of an identical shot would appear to do
            // nothing.
            e.target.value = '';
            if (file) void store(file);
          }}
        />
      </div>

      {atLimit && <p className="text-xs text-muted-foreground">Maximum of {max} photos.</p>}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <CameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        busy={busy}
        onCapture={(blob) => {
          setCameraOpen(false);
          void store(blob);
        }}
        onUnavailable={() => {
          setCameraOpen(false);
          // Not an error worth a toast on its own — the file input opens the
          // phone's camera app just as well, so send them there instead of
          // leaving them staring at a dead dialog.
          fileInputRef.current?.click();
        }}
      />
    </div>
  );
}

/**
 * The live-preview shutter.
 *
 * The stream is opened when the dialog opens and stopped when it closes —
 * unconditionally, in the effect's cleanup. A MediaStream that outlives its
 * dialog leaves the camera indicator lit on the device, which users reasonably
 * read as the app spying on them.
 */
function CameraDialog({
  open,
  onOpenChange,
  busy,
  onCapture,
  onUnavailable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onCapture: (blob: Blob) => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // No setReady(false) here: the cleanup below already does it, and a cleanup
    // always runs before the next effect, so `ready` is false by the time this
    // re-runs. Setting it here as well would be a redundant synchronous setState
    // in an effect body (react-hooks/set-state-in-effect).

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `environment` asks for the rear camera on a phone and is ignored on a
          // laptop, which has only one. Not `exact`: an exact constraint throws
          // outright on a device with no rear camera rather than falling back.
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        // Permission denied, no camera, or a browser that refuses on this
        // origin. All three mean the same thing here: use the other path.
        if (!cancelled) onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
    };
  }, [open, onUnavailable]);

  function shoot() {
    const video = videoRef.current;
    if (!video) return;

    // Captured at the sensor's own resolution; compressImage does the
    // downscaling, so the shutter never has to guess a target size.
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob);
    }, 'image/jpeg', 0.92);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Take a photo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className={cn('h-64 w-full object-cover transition-opacity', ready ? 'opacity-100' : 'opacity-0')}
            />
          </div>
          <Button type="button" size="lg" className="w-full" disabled={!ready || busy} onClick={shoot}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            Capture
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
