'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EDITABLE_DOC_STATUSES, type FinanceDocStatus } from '@mb/shared';
import type { FinanceAbilities } from './finance-ui';
import { Check, Send, X } from 'lucide-react';

/**
 * The approval controls, once, for the four document screens that share them.
 *
 * Manual entries, salaries and partner expenses walk the SAME lifecycle
 * (draft → pending_approval → approved/posted → locked, or → rejected) against
 * the SAME endpoint shapes — `POST {base}/{id}/submit|approve|reject`. Writing
 * the buttons three times would mean three places where a future fourth state
 * gets handled in two of them.
 *
 * Rejection always asks for a reason and approval never does, which mirrors the
 * API: RejectSchema requires one, ApproveSchema's notes are optional. A rejected
 * document that does not say why is the thing its author cannot act on.
 */

// ---------------------------------------------------------------------------
// Approve / reject / submit
// ---------------------------------------------------------------------------

export interface ApprovableDocument {
  id: string;
  status: FinanceDocStatus;
}

export function DocumentActions({
  doc,
  /** Endpoint prefix, e.g. `/api/finance/payroll/salaries`. */
  basePath,
  abilities,
  /** Shown in the reject dialog so the approver can see what they are refusing. */
  label,
}: {
  doc: ApprovableDocument;
  basePath: string;
  abilities: FinanceAbilities;
  label: string;
}) {
  const submitMut = useFinanceMutation();
  const approveMut = useFinanceMutation();
  const [rejecting, setRejecting] = useState(false);

  const editable = EDITABLE_DOC_STATUSES.includes(doc.status);
  const awaitingDecision = doc.status === 'pending_approval';

  async function run(action: 'submit' | 'approve', mut: typeof submitMut, success: string) {
    try {
      await mut.mutateAsync({ path: `${basePath}/${doc.id}/${action}`, body: {} });
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not ${action} this document`);
    }
  }

  // A settled document (approved, posted, locked) has no actions at all. Its
  // figures are in the book and the only route back is an adjustment on the
  // ledger itself — see the Daily Ledger page.
  if (!editable && !awaitingDecision) return null;

  return (
    <div className="flex items-center justify-end gap-1">
      {editable && abilities.create && (
        <Button
          variant="outline"
          size="sm"
          disabled={submitMut.isPending}
          onClick={() => void run('submit', submitMut, 'Submitted for approval')}
        >
          <Send className="h-3.5 w-3.5" />
          Submit
        </Button>
      )}

      {awaitingDecision && abilities.approve && (
        <>
          <Button
            size="sm"
            disabled={approveMut.isPending}
            onClick={() => void run('approve', approveMut, 'Approved and posted to the ledger')}
          >
            <Check className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setRejecting(true)}>
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
        </>
      )}

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        path={`${basePath}/${doc.id}/reject`}
        label={label}
      />
    </div>
  );
}

/**
 * Ask for a reason, then reject.
 *
 * Kept separate from DocumentActions because Branch Income rejects the same way
 * but has an entirely different action set around it.
 */
export function RejectDialog({
  open,
  onOpenChange,
  path,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: string;
  label: string;
}) {
  const [reason, setReason] = useState('');
  const mut = useFinanceMutation();

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error('Please give a reason of at least 3 characters');
      return;
    }
    try {
      await mut.mutateAsync({ path, body: { reason: reason.trim() } });
      toast.success('Rejected');
      setReason('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject this document');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {label}</DialogTitle>
          <DialogDescription>
            The reason is recorded on the document and in the audit trail, and is what tells its author what to fix.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Amount does not match the attached invoice"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={mut.isPending} onClick={() => void submit()}>
            {mut.isPending ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

/**
 * The filter strip above every finance list.
 *
 * A plain wrapper rather than a configurable component: the six screens filter
 * on genuinely different things, and a props-driven filter builder would be
 * longer than the six explicit strips it replaced.
 */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">{children}</div>
  );
}

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ?? 'min-w-[9rem] flex-1 space-y-1 sm:flex-none'}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** A date input sized for touch, used by every date filter in the module. */
export function DateFilter({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
}) {
  return (
    <Input
      type="date"
      value={value}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 md:h-9"
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A filter dropdown whose empty option means "no filter".
 *
 * Base UI's Select cannot hold an empty-string item value, so the "all" choice
 * carries the sentinel `__all__` and is mapped back to `''` here. Every caller
 * would otherwise reinvent that mapping, and the one that got it wrong would
 * send `?status=__all__` to the API.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel = 'All',
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  allLabel?: string;
  placeholder?: string;
}) {
  const ALL = '__all__';
  return (
    <Select
      value={value === '' ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? '' : ((v as string) ?? ''))}
    >
      <SelectTrigger className="h-11 w-full md:h-9">
        <SelectValue placeholder={placeholder ?? allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
