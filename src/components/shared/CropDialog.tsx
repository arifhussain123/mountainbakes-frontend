'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, Maximize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CropArea } from '@/lib/attachments';
import { cn } from '@/lib/utils';

/**
 * Crop a photo: a frame over the picture whose corners and sides are dragged to
 * make it bigger or smaller, and whose middle is dragged to move it.
 *
 * The whole point is READABILITY: a slip photographed on a counter is a small
 * rectangle in a large frame, and the stored image is normalised to one size
 * (compressImage). Cropping to the slip first means the stored pixels are the
 * slip's, not the counter's.
 *
 * Free-form (owner, 2026-11-12): any shape, set by the eight handles, rather
 * than the three fixed shapes it used to offer.
 *
 * The frame is kept as fractions of the picture (0–1), so it does not care how
 * large the picture is drawn; it becomes pixels only when confirmed.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Mode = Handle | 'move';

/** Smallest frame, as a fraction of the picture's side. */
const MIN = 0.05;
const START: Rect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

const HANDLES: { key: Handle; className: string; cursor: string; label: string }[] = [
  { key: 'nw', className: 'left-0 top-0', cursor: 'nwse-resize', label: 'top-left corner' },
  { key: 'n', className: 'left-1/2 top-0', cursor: 'ns-resize', label: 'top side' },
  { key: 'ne', className: 'left-full top-0', cursor: 'nesw-resize', label: 'top-right corner' },
  { key: 'e', className: 'left-full top-1/2', cursor: 'ew-resize', label: 'right side' },
  { key: 'se', className: 'left-full top-full', cursor: 'nwse-resize', label: 'bottom-right corner' },
  { key: 's', className: 'left-1/2 top-full', cursor: 'ns-resize', label: 'bottom side' },
  { key: 'sw', className: 'left-0 top-full', cursor: 'nesw-resize', label: 'bottom-left corner' },
  { key: 'w', className: 'left-0 top-1/2', cursor: 'ew-resize', label: 'left side' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The frame after dragging `mode` by (dx, dy), both fractions of the picture. */
export function dragRect(start: Rect, mode: Mode, dx: number, dy: number): Rect {
  if (mode === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (mode.includes('w')) left = clamp(left + dx, 0, right - MIN);
  if (mode.includes('e')) right = clamp(right + dx, left + MIN, 1);
  if (mode.includes('n')) top = clamp(top + dy, 0, bottom - MIN);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + MIN, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function CropDialog({
  source,
  busy = false,
  onConfirm,
  onCancel,
}: {
  /** The frame to crop; null closes the dialog. */
  source: Blob | null;
  busy?: boolean;
  /** The chosen area in the picture's own pixels. */
  onConfirm: (area: CropArea) => void;
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
          <DialogDescription>
            Drag a corner or a side to make the frame bigger or smaller; drag inside it to move it. Keep the whole slip in
            the frame.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by the URL so a new picture starts from a fresh frame without
            an effect having to reset it. */}
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
  onConfirm: (area: CropArea) => void;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState<Rect>(START);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; startX: number; startY: number; start: Rect; width: number; height: number } | null>(null);

  function begin(mode: Mode, e: ReactPointerEvent<HTMLElement>) {
    if (busy || !boxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current.getBoundingClientRect();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect, width: box.width, height: box.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.width === 0 || d.height === 0) return;
    setRect(dragRect(d.start, d.mode, (e.clientX - d.startX) / d.width, (e.clientY - d.startY) / d.height));
  }

  function end(e: ReactPointerEvent<HTMLElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function confirm() {
    if (!natural) return;
    onConfirm({
      x: rect.x * natural.width,
      y: rect.y * natural.height,
      width: rect.w * natural.width,
      height: rect.h * natural.height,
    });
  }

  const pct = (v: number) => `${v * 100}%`;
  const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  return (
    <div className="space-y-3">
      <div className="flex h-72 w-full items-center justify-center overflow-hidden rounded-lg border bg-black sm:h-80">
        {/* Sized to the picture as drawn, so the frame's fractions are the picture's. */}
        <div ref={boxRef} className="relative touch-none select-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
          <img
            src={url}
            alt="Photo to crop"
            draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            className="block max-h-72 max-w-full sm:max-h-80"
          />
          {natural && (
            <div
              role="group"
              aria-label="Crop frame"
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
              onPointerDown={(e) => begin('move', e)}
              {...pointer}
            >
              {/* Thirds, to line the slip up. */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="border border-white/25" />
                ))}
              </div>
              {HANDLES.map((h) => (
                <span
                  key={h.key}
                  aria-label={`Resize from the ${h.label}`}
                  // A 32px touch target around a 14px square.
                  className={cn('absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center', h.className)}
                  style={{ cursor: h.cursor }}
                  onPointerDown={(e) => begin(h.key, e)}
                  {...pointer}
                >
                  <span className="h-3.5 w-3.5 rounded-sm border-2 border-primary bg-white shadow" />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {natural
            ? `${Math.round(rect.w * natural.width)} × ${Math.round(rect.h * natural.height)} px`
            : 'Loading the picture…'}
        </p>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRect(FULL)}>
            <Maximize2 className="mr-1 h-3.5 w-3.5" />
            Whole photo
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Reset" disabled={busy} onClick={() => setRect(START)}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={busy || !natural} onClick={confirm}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {busy ? 'Saving…' : 'Use this crop'}
        </Button>
      </div>
    </div>
  );
}
