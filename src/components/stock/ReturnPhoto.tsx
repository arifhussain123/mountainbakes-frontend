'use client';

import { memo } from 'react';
import type { ProductionReturn } from '@mb/shared';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDate, formatDateTime } from '@/utils/date';

/**
 * The photo a branch took of a return: a thumbnail that opens the full picture
 * with the return it belongs to written underneath.
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
  size?: 'md' | 'sm';
}) {
  if (!row.photo) return <span className="text-muted-foreground">—</span>;

  return (
    <AttachmentGallery
      attachments={[row.photo]}
      size={size}
      title="Return Photo"
      details={
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
      }
    />
  );
});
