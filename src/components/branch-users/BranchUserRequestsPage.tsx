'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus, UserCog } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBranchUserRequests } from '@/lib/queries';
import type { BranchUserRequest } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Fab } from '@/components/shared/Fab';
import { RequestBranchUserForm } from './RequestBranchUserForm';
import { ShiftBadge, StatusBadge, formatStamp } from './requestStatus';

const col = createColumnHelper<BranchUserRequest>();

/**
 * The manager's half of the shift-account queue: ask for an account, then watch
 * what Admin did with it.
 *
 * A manager cannot create the account here and there is deliberately no button
 * that looks like they can — minting a login means writing role and branch into
 * Supabase `app_metadata`, which only the service-role key may do. What the
 * manager controls is the request; what Admin controls is the account.
 *
 * The list is the same endpoint the admin queue reads, scoped server-side from
 * the JWT to this manager's own branch.
 */
export function BranchUserRequestsPage() {
  const { token } = useAuth();
  const { data: requests = [], isLoading } = useBranchUserRequests(token);
  const [showForm, setShowForm] = useState(false);

  const columns = [
    col.accessor('requestNo', {
      header: 'Request',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('displayName', {
      header: 'Staff Name',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('email', {
      header: 'Login Email',
      meta: { mobileFull: true },
      cell: (i) => <span className="text-sm">{i.getValue()}</span>,
    }),
    col.accessor('shift', { header: 'Shift', cell: (i) => <ShiftBadge shift={i.getValue()} /> }),
    col.accessor('status', { header: 'Status', cell: (i) => <StatusBadge status={i.getValue()} /> }),
    col.accessor('createdAt', {
      header: 'Requested',
      cell: (i) => <span className="text-sm text-muted-foreground">{formatStamp(i.getValue())}</span>,
    }),
    // One column for the outcome, because a request only ever has one: the
    // reviewer's name once approved, the reason once declined, nothing while it
    // is still pending. Two columns would be empty in every row but one.
    col.display({
      id: 'outcome',
      header: 'Outcome',
      meta: { mobileFull: true },
      cell: ({ row }) => {
        const r = row.original;
        if (r.status === 'pending') return <span className="text-muted-foreground">Awaiting Admin</span>;
        if (r.status === 'rejected') {
          return <span className="text-sm text-destructive">{r.rejectionReason}</span>;
        }
        return (
          <span className="text-sm text-muted-foreground">
            Account created{r.reviewedByName ? ` by ${r.reviewedByName}` : ''}
            {r.reviewedAt ? ` · ${formatStamp(r.reviewedAt)}` : ''}
          </span>
        );
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Shift Accounts</h2>
          <p className="text-sm text-muted-foreground">
            Ask Admin to open a morning or evening account on this branch
          </p>
        </div>
        <Button className="hidden md:inline-flex" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> Request Account
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={requests}
        loading={isLoading}
        searchPlaceholder="Search requests…"
        empty={
          <EmptyState
            icon={UserCog}
            title="No account requests yet"
            description="A shift account signs in to this same branch and sees New Orders, Sales, Stock, Shop Expenses, Events and Branch Closing."
            action={
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-1" /> Request Account
              </Button>
            }
          />
        }
      />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request a Shift Account</DialogTitle>
          </DialogHeader>
          <RequestBranchUserForm onSuccess={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      <Fab onClick={() => setShowForm(true)} icon={Plus} label="Request a shift account" />
    </div>
  );
}
