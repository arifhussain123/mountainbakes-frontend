'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Crop a captured photo before it is compressed and uploaded.
 *
 * The whole point is READABILITY: a slip photographed on a counter is a small
 * rectangle in a large frame, and the stored image is normalised to one size
 * (compressImage). Cropping to the slip first means the stored pixels are the
 * slip's, not the counter's. Drag to reposition, pinch or the buttons to zoom.
 *
 * Three frame shapes rather than a free-form rectangle, because the underlying
 * cropper works on an aspect and a receipt is nearly always portrait: the
 * defaults are the three shapes a slip, a transfer screenshot and a bank
 * counterfoil actually come in.
 */
const ASPECTS: { key: string; label: string; value: number }[] = [
  { key: 'portrait', label: 'Portrait', value: 3 / 4 },
  { key: 'square', label: 'Square', value: 1 },
  { key: 'landscape', label: 'Landscape', value: 4 / 3 },
];

export function CropDialog({
  source,
  busy = false,
  onConfirm,
  onCancel,
}: {
  /** The frame to crop; null closes the dialog. */
  source: Blob | null;
  busy?: boolean;
  onConfirm: (area: Area) => void;
  onCancel: () => void;
}) {
  // One object URL per source, derived rather than set in an effect, and
  // revoked when it changes or the dialog closes — a captured frame is several
  // megabytes and a leaked URL pins it in memory.
  const url = useMemo(() => (source ? URL.createObjectURL(source) : null), [source]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crop the photo</DialogTitle>
          <DialogDescription>Drag to move, pinch or use the buttons to zoom. Keep the whole slip in the frame.</DialogDescription>
        </DialogHeader>
        {/* Keyed by the URL so a new frame starts from a fresh crop and zoom
            without an effect having to reset them. */}
        {url && <CropSurface key={url} url={url} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />}
      </DialogContent>
    </Dialog>
  );
}

function CropSurface({
  url,
  busy,
  onConfirm,
  onCancel,
}: {
  url: string;
  busy: boolean;
  onConfirm: (area: Area) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(ASPECTS[0]!);
  const [area, setArea] = useState<Area | null>(null);
  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  return (
    <div className="space-y-3">
      <div className="relative h-72 w-full overflow-hidden rounded-lg border bg-black sm:h-80">
        <Cropper
          image={url}
          crop={crop}
          zoom={zoom}
          aspect={aspect.value}
          objectFit="contain"
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          minZoom={1}
          maxZoom={4}
          zoomSpeed={0.3}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="radiogroup" aria-label="Frame shape">
          {ASPECTS.map((a) => (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={aspect.key === a.key}
              onClick={() => setAspect(a)}
              disabled={busy}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                aspect.key === a.key ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-muted',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom out" disabled={busy || zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom in" disabled={busy || zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Reset" disabled={busy} onClick={() => { setZoom(1); setCrop({ x: 0, y: 0 }); }}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={busy || !area} onClick={() => area && onConfirm(area)}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {busy ? 'Saving…' : 'Use this crop'}
        </Button>
      </div>
    </div>
  );
}
