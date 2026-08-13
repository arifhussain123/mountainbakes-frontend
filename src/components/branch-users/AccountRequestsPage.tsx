'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Check, Inbox, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useApproveBranchUserRequest,
  useBranchUserRequests,
  useRejectBranchUserRequest,
} from '@/lib/queries';
import type { BranchUserRequest } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { toast } from 'sonner';
import { ShiftBadge, StatusBadge, formatStamp } from './requestStatus';

const col = createColumnHelper<BranchUserRequest>();

/**
 * Admin's half of the queue — the screen where a shift account is actually
 * created, on the requesting manager's branch rather than the admin's own.
 *
 * Pending rows sort to the top: this is a work queue, and a decided request is
 * history. The list itself is not filtered, so an admin can still find what they
 * approved last week by searching for it.
 */
export function AccountRequestsPage() {
  const { token } = useAuth();
  const { data: requests = [], isLoading } = useBranchUserRequests(token);
  const approve = useApproveBranchUserRequest(token);
  const reject = useRejectBranchUserRequest(token);

  const [approving, setApproving] = useState<BranchUserRequest | null>(null);
  const [rejecting, setRejecting] = useState<BranchUserRequest | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');

  const rows = useMemo(
    () =>
      [...requests].sort((a, b) => {
        if (a.status === b.status) return b.createdAt.localeCompare(a.createdAt);
        return a.status === 'pending' ? -1 : b.status === 'pending' ? 1 : 0;
      }),
    [requests],
  );

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  function openApprove(request: BranchUserRequest) {
    setPassword('');
    // The email local part is what the API falls back to, so showing it as the
    // starting value means the admin sees the username they are about to create
    // rather than an empty box that silently fills itself in.
    setUsername(request.email.split('@')[0] ?? '');
    setApproving(request);
  }

  async function submitApprove() {
    if (!approving) return;
    try {
      await approve.mutateAsync({
        id: approving.id,
        password,
        ...(username ? { username } : {}),
      });
      toast.success(`${approving.displayName}'s account is active`);
      setApproving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create the account');
    }
  }

  async function submitReject() {
    if (!rejecting) return;
    try {
      await reject.mutateAsync({ id: rejecting.id, reason });
      toast.success('Request declined');
      setRejecting(null);
      setReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to decline the request');
    }
  }

  const columns = [
    col.accessor('requestNo', {
      header: 'Request',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('branchName', {
      header: 'Branch',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('displayName', { header: 'Staff Name', cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('email', {
      header: 'Login Email',
      meta: { mobileFull: true },
      cell: (i) => <span className="text-sm">{i.getValue()}</span>,
    }),
    col.accessor('shift', { header: 'Shift', cell: (i) => <ShiftBadge shift={i.getValue()} /> }),
    col.accessor('requestedByName', {
      header: 'Requested By',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('note', {
      header: 'Note',
      meta: { mobileFull: true },
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() || '—'}</span>,
    }),
    col.accessor('status', { header: 'Status', cell: (i) => <StatusBadge status={i.getValue()} /> }),
    col.display({
      id: 'actions',
      header: 'Action',
      meta: { mobileFull: true },
      cell: ({ row }) => {
        const r = row.original;
        if (r.status !== 'pending') {
          return (
            <span className="text-xs text-muted-foreground">
              {r.reviewedByName ?? '—'}
              {r.reviewedAt ? ` · ${formatStamp(r.reviewedAt)}` : ''}
            </span>
          );
        }
        return (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => openApprove(r)}>
              <Check className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setReason(''); setRejecting(r); }}>
              <X className="h-4 w-4 mr-1" /> Decline
            </Button>
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Account Requests</h2>
        <p className="text-sm text-muted-foreground">
          {pendingCount > 0
            ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} awaiting a decision`
            : 'Shift accounts requested by branch managers'}
        </p>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Search requests…"
        empty={
          <EmptyState
            icon={Inbox}
            title="No account requests"
            description="Branch managers ask for morning and evening accounts from their Shift Accounts page."
          />
        }
      />

      {/* Approve. The password is set here and nowhere else — it is the one part
          of the account the queue deliberately never carried. */}
      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Shift Account</DialogTitle>
          </DialogHeader>
          {approving && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-medium">{approving.displayName}</p>
                <p className="text-muted-foreground">{approving.email}</p>
                <p className="text-muted-foreground">
                  {approving.branchName} · {approving.shift === 'morning' ? 'Morning shift' : 'Evening shift'}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                The account is created on <span className="font-medium">{approving.branchName}</span> — the
                requesting manager&apos;s branch, not yours. It reads and writes that branch&apos;s data.
              </p>

              <div className="space-y-1">
                <Label>Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              </div>

              <div className="space-y-1">
                <Label>Password</Label>
                <Input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
                <p className="text-xs text-muted-foreground">
                  Share this with the manager — it is not stored anywhere they can read it back.
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setApproving(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={password.length < 8 || approve.isPending}
                  onClick={submitApprove}
                >
                  {approve.isPending ? 'Creating…' : 'Create Account'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Decline. A reason is mandatory — the manager is told why, not just no. */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline Request</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {rejecting.displayName} · {rejecting.branchName}
              </p>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="The manager sees this."
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setRejecting(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  disabled={!reason.trim() || reject.isPending}
                  onClick={submitReject}
                >
                  {reject.isPending ? 'Declining…' : 'Decline'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
