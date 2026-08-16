'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Camera, ImageUp, Loader2, X } from 'lucide-react';
import { ATTACHMENT_MAX_PER_ENTITY, type Attachment, type AttachmentEntity } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  canUseLiveCamera,
  captureAndUpload,
  formatBytes,
  prefersDeviceCamera,
  subscribeDeviceCamera,
} from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

/**
 * Capture a photo, compress it, upload it, and hand the caller back the stored
 * attachments.
 *
 * TWO CAPTURE PATHS, and which one "Take photo" uses depends on the device:
 *
 *   * **The device camera app** (`<input capture="environment">`) — what a PHONE
 *     gets. It returns a full-resolution still, focused and sharpened by the
 *     camera pipeline. This is the path that makes a photographed receipt
 *     readable, and it is why phones no longer get the in-app preview.
 *   * **Live camera** (`getUserMedia` + `<video>`) — a preview inside the app
 *     with a shutter button, kept for DESKTOP, where `<input capture>` is
 *     ignored and degrades to a file picker, leaving no capture path at all. It
 *     needs a secure context, so it is absent over plain http.
 *
 * A grabbed video frame is not a photograph — see `prefersDeviceCamera`. The
 * live path remains the desktop fallback, and the fallback for a phone whose
 * camera app cannot be reached.
 *
 * The gallery gets its OWN input, without `capture`. Sharing one input with the
 * camera meant "Upload" opened the camera too on the phones that honour the
 * attribute, so an existing photo could not be attached at all.
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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // `false` during prerender, the real answer once mounted — see
  // subscribeDeviceCamera for why this is a store subscription rather than
  // state set in an effect.
  const useDeviceCamera = useSyncExternalStore(subscribeDeviceCamera, prefersDeviceCamera, () => false);

  const atLimit = value.length >= max;
  const canCapture = !disabled && !busy && !atLimit;

  // A phone goes straight to its camera app; a desktop opens the in-app preview.
  const takePhoto = useCallback(() => {
    if (useDeviceCamera) cameraInputRef.current?.click();
    else setCameraOpen(true);
  }, [useDeviceCamera]);

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
        {/* Present on a phone (device camera) and on a desktop that can open a
            live preview. Absent only where neither exists — an http desktop —
            where the gallery button below is the whole story. */}
        {(useDeviceCamera || canUseLiveCamera()) && (
          <Button type="button" variant="outline" disabled={!canCapture} onClick={takePhoto}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            Take photo
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!canCapture}
          onClick={() => galleryInputRef.current?.click()}
        >
          <ImageUp className="mr-1.5 h-4 w-4" />
          {useDeviceCamera ? 'Gallery' : 'Upload'}
        </Button>

        {/* Camera. `capture` sends a phone straight to its camera app; a desktop
            ignores it, which is why this input is only ever clicked on a phone. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
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

        {/* Gallery / file picker. No `capture`, or a phone would open the camera
            here too and an existing photo could never be attached. */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
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
          // Not an error worth a toast on its own — the camera input opens the
          // device's camera app just as well, so send them there instead of
          // leaving them staring at a dead dialog.
          cameraInputRef.current?.click();
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
          //
          // The `ideal` sizes matter more than they look. Asked for nothing, a
          // browser hands back its default capture size — commonly 640×480 — and
          // that VGA frame, not the compression, is what made a photographed
          // receipt unreadable. `ideal` is a preference, not a demand: a webcam
          // that cannot reach it simply returns its best.
          video: {
            facingMode: 'environment',
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
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

    // Captured at whatever the stream negotiated; compressImage normalises it to
    // the stored size, so the shutter never has to guess a target.
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 0.98: this frame is an intermediate that compressImage immediately decodes
    // and re-encodes. Any quality thrown away here is thrown away twice, and
    // these bytes never leave the device.
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob);
    }, 'image/jpeg', 0.98);
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
