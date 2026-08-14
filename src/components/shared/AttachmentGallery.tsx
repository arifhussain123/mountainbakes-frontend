'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { Attachment } from '@mb/shared';
import { formatBytes } from '@/lib/attachments';
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
 */
export function AttachmentGallery({
  attachments,
  size = 'sm',
  title = 'Photo',
  className,
  emptyText,
}: {
  attachments: Attachment[] | undefined;
  size?: 'xs' | 'sm';
  title?: string;
  className?: string;
  /** Shown when there are none. Omit to render nothing at all. */
  emptyText?: string;
}) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const items = attachments ?? [];

  if (items.length === 0) {
    return emptyText ? <p className={cn('text-xs text-muted-foreground', className)}>{emptyText}</p> : null;
  }

  const box = size === 'xs' ? 'h-9 w-9' : 'h-16 w-16';

  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setViewing(a)}
            title={`${title} · ${formatBytes(a.sizeBytes)}`}
            className={cn(
              'overflow-hidden rounded-md border transition-opacity hover:opacity-80',
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
            /* eslint-disable-next-line @next/next/no-img-element -- see the note
               in PhotoCapture: next/image is unavailable in a static export and
               the src is a signed URL, not an owned asset. */
            <img
              src={viewing.url}
              alt={title}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
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
}

function Thumb({ attachment, alt }: { attachment: Attachment; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- as above. */
    <img
      src={attachment.url}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
