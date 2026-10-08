'use client';

import { memo, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import type { Attachment } from '@mb/shared';
import { forgetStableAttachmentUrl, formatBytes, stableAttachmentUrl } from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Read-only display for photos already attached to a document.
 *
 * The thumbnails are deliberately small and the full image opens in a dialog: a
 * ledger row or an order card has no room for a legible receipt, and the whole
 * reason someone looks at one is to read the figures on it.
 *
 * Every `url` here is a SHORT-LIVED signed URL minted when the parent was
 * fetched (the bucket is private). It expires — roughly an hour — so a tab left
 * open overnight will show broken thumbnails until the query refetches. That is
 * why `onError` swaps in a placeholder rather than leaving a broken-image icon:
 * the photo is not gone, the link is just stale.
 *
 * It is also RE-MINTED on every fetch, which is why nothing below renders
 * `attachment.url` directly — see `stableAttachmentUrl`. Without it a list that
 * refetches downloads every thumbnail again each time.
 */
export const AttachmentGallery = memo(function AttachmentGallery({
  attachments,
  size = 'sm',
  title = 'Photo',
  className,
  emptyText,
  details,
}: {
  attachments: Attachment[] | undefined;
  /** xs 36px · md 48px (a table cell) · sm 64px. */
  size?: 'xs' | 'md' | 'sm';
  title?: string;
  className?: string;
  /** Shown when there are none. Omit to render nothing at all. */
  emptyText?: string;
  /**
   * What the photo is OF, shown under the full-size image — the return it
   * belongs to, say. A photo opened from a table row has left its row behind,
   * and without this the viewer is a picture with no caption.
   */
  details?: ReactNode;
}) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const items = attachments ?? [];

  if (items.length === 0) {
    return emptyText ? <p className={cn('text-xs text-muted-foreground', className)}>{emptyText}</p> : null;
  }

  const box = size === 'xs' ? 'h-9 w-9' : size === 'md' ? 'h-12 w-12' : 'h-16 w-16';

  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setZoomed(false);
              setViewing(a);
            }}
            title={`${title} · ${formatBytes(a.sizeBytes)}`}
            aria-label={`View ${title.toLowerCase()}`}
            className={cn(
              'shrink-0 overflow-hidden rounded-md border transition-opacity hover:opacity-80',
              box,
            )}
          >
            <Thumb attachment={a} alt={title} />
          </button>
        ))}
      </div>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {viewing && (
            // Click to zoom: contained by default so the whole photo is in view,
            // full width in a scrolling box when someone wants a closer look.
            // The image is the stored one either way — there is no larger
            // original to fetch.
            <div className={cn('rounded-lg', zoomed && 'max-h-[70dvh] overflow-auto')}>
              {/* eslint-disable-next-line @next/next/no-img-element -- see the note
                  in PhotoCapture: next/image is unavailable in a static export and
                  the src is a signed URL, not an owned asset. */}
              <img
                src={stableAttachmentUrl(viewing)}
                alt={title}
                onClick={() => setZoomed((z) => !z)}
                className={cn(
                  'rounded-lg',
                  zoomed
                    ? 'w-[200%] max-w-none cursor-zoom-out'
                    : 'max-h-[70dvh] w-full cursor-zoom-in object-contain',
                )}
              />
            </div>
          )}
          {viewing && details}
          {viewing && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(viewing.sizeBytes)}
              {viewing.uploadedByName ? ` · ${viewing.uploadedByName}` : ''}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});

function Thumb({ attachment, alt }: { attachment: Attachment; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }

  return (
    /* `loading="lazy"` is what keeps a page of rows from fetching every photo at
       once: only thumbnails near the viewport are requested. The muted pulse
       holds the cell's shape until the picture arrives, so the row does not
       jump. */
    /* eslint-disable-next-line @next/next/no-img-element -- as above. */
    <img
      src={stableAttachmentUrl(attachment)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => {
        // The held URL has died (an hour-old tab). Forget it so the next
        // refetch's fresh one is used instead of this one again.
        forgetStableAttachmentUrl(attachment.id);
        setFailed(true);
      }}
      className={cn('h-full w-full object-cover', !loaded && 'animate-pulse bg-muted')}
    />
  );
}
