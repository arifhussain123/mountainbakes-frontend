'use client';

import { memo } from 'react';
import type { ProductionReturn } from '@mb/shared';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';

/** Shown with a photo that covers a whole submission rather than this line. */
export const LEGACY_SINGLE_PHOTO_NOTE = 'One photo for all items (older return)';

/**
 * The photo a branch took of ONE returned product: a thumbnail that opens the
 * full picture with the return it belongs to written underneath.
 *
 * Each return row is one product, and since photos went per line each carries
 * its own picture — so "Photo of returned Classic Brownie" is literally true.
 * Returns raised before that (`legacySinglePhoto`) share one photo across every
 * product of their submission; the same picture then appears on each of those
 * rows, and the note says so, so a reviewer does not go looking for brownies in
 * what is really a photo of the whole tray.
 *
 * ONE component for both lists that show a return — the branch's own Return
 * Stock page and Production's queue — and for both places each shows it (the
 * table cell and the detail dialog), so the photo cannot look or behave
 * differently depending on where it was opened from.
 *
 * Memoised on the row, and the row object is stable across a refetch that
 * changes nothing (React Query's structural sharing), so one thumbnail loading
 * does not re-render the others.
 *
 * Renders a dash when there is no photo: returns raised before photos existed,
 * and the ones Production records itself, legitimately have none.
 */
export const ReturnPhoto = memo(function ReturnPhoto({
  row,
  size = 'md',
}: {
  row: ProductionReturn;
  /** `md` in a table cell (centred), `sm` in a detail dialog (start-aligned). */
  size?: 'md' | 'sm';
}) {
  if (!row.photo) return <span className="text-muted-foreground">—</span>;

  const legacy = row.legacySinglePhoto === true;
  const title = legacy ? 'Photo of the whole return' : `Photo of returned ${row.productName}`;

  return (
    <div className={cn('flex flex-col gap-1', size === 'md' ? 'items-center' : 'items-start')}>
      <AttachmentGallery
        attachments={[row.photo]}
        size={size}
        title={title}
        details={
          <>
            {legacy && (
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{LEGACY_SINGLE_PHOTO_NOTE}</p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Return ID</dt>
              <dd className="break-all text-right font-mono text-xs">{row.id}</dd>

              <dt className="text-muted-foreground">Product</dt>
              <dd className="text-right font-medium">
                {row.productName} <span className="tabular-nums text-muted-foreground">× {row.qty}</span>
              </dd>

              <dt className="text-muted-foreground">Branch</dt>
              <dd className="text-right">{row.branchName.replace('Mountain Bakes ', '')}</dd>

              <dt className="text-muted-foreground">Business day</dt>
              <dd className="text-right">{formatDate(row.date)}</dd>

              <dt className="text-muted-foreground">Recorded</dt>
              <dd className="text-right">{formatDateTime(row.createdAt)}</dd>

              <dt className="text-muted-foreground">Reason</dt>
              <dd className="text-right">{row.reason || '—'}</dd>
            </dl>
          </>
        }
      />
      {legacy && (
        <p
          className={cn(
            'text-muted-foreground',
            // A table cell is narrow: small and wrapped under the thumbnail.
            size === 'md' ? 'max-w-[7.5rem] text-center text-[11px] leading-tight' : 'text-xs',
          )}
        >
          {LEGACY_SINGLE_PHOTO_NOTE}
        </p>
      )}
    </div>
  );
});
