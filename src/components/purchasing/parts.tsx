'use client';

import { useState, type ReactNode } from 'react';
import { ReasonSchema } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/utils/api';
import { formatCurrency } from '@/utils/currency';
import { cn } from '@/lib/utils';
import { toneClass, type Tone } from './purchasing-model';

/**
 * Small building blocks shared by every WhatsApp Purchasing screen: the status
 * pill, a labelled field with its error, money, and the two confirmation
 * dialogs (plain, and with a required reason).
 */

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', toneClass(tone), className)}>
      {children}
    </span>
  );
}

/** Rs. with up to two decimals; a dash for "no figure yet" rather than a misleading Rs. 0. */
export function money(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : formatCurrency(Number(n));
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The API's own sentence for a refusal ("It is awaiting supplier."), which says more than a generic failure. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message || fallback : fallback;
}

/**
 * "Are you sure?" for an irreversible action — approve, reject, receive, pay.
 * Names what happens in `description`; the confirm button carries the verb.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Back
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={pending}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A decision that needs its reason written down — reject, request changes,
 * cancel. The reason goes to the supplier on WhatsApp for the first two, so it
 * is validated with the server's own ReasonSchema (three characters at least).
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  placeholder,
  destructive,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  placeholder?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  // Fresh each time it opens — a reason typed for one decision must not be
  // waiting in the box for the next.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason('');
      setAttempted(false);
    }
  }
  const parsed = ReasonSchema.safeParse({ reason });
  const error = attempted && !parsed.success ? parsed.error.issues[0]?.message ?? 'Give a reason' : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="purchasing-reason" error={error}>
          <Textarea
            id="purchasing-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            maxLength={1000}
            rows={3}
            aria-invalid={!!error}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Back
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => {
              setAttempted(true);
              if (parsed.success) onConfirm(parsed.data.reason);
            }}
          >
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A label/value list, two columns, values right-aligned — the detail's summary blocks. */
export function Facts({ rows, className }: { rows: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm', className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3 rounded-xl border bg-card p-3 sm:p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A native checkbox with its label, matching the ones the Finance dialogs use. */
export function Check({ checked, onChange, children, id }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" />
      <span>{children}</span>
    </label>
  );
}
