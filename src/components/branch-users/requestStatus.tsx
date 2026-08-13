import { Badge } from '@/components/ui/badge';
import { BRANCH_SHIFT_LABELS, type BranchShift, type BranchUserRequestStatus } from '@mb/shared';

/**
 * One rendering of a request's status, shared by the manager's Shift Accounts
 * page and the admin's Account Requests queue.
 *
 * The two screens show the same rows to different people, so the colour a
 * request wears has to be the same on both — a manager told "approved" in green
 * and an admin seeing amber for the same row is a support call.
 */
const STATUS_VARIANT: Record<BranchUserRequestStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  approved: 'default',
  rejected: 'destructive',
};

const STATUS_LABEL: Record<BranchUserRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Declined',
};

export function StatusBadge({ status }: { status: BranchUserRequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Morning / Evening. The label carries no authority — see BranchShift. */
export function ShiftBadge({ shift }: { shift: BranchShift }) {
  return (
    <Badge variant={shift === 'morning' ? 'secondary' : 'outline'}>
      {BRANCH_SHIFT_LABELS[shift]}
    </Badge>
  );
}

/** `2026-08-12T…Z` → `12 Aug 2026, 14:05`. Empty string for a null timestamp. */
export function formatStamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
