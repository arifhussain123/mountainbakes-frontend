'use client';

import { useState } from 'react';
import { apiCall } from '@/utils/api';
import { ChangeUserEmailSchema, type ChangeUserEmailInput, type User } from '@mb/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowRight, Loader2 } from 'lucide-react';

type Field = 'email' | 'confirmEmail' | 'reason';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="text-xs text-destructive">{message}</p>;
}

export function ChangeEmailDialog({
  user,
  open,
  onOpenChange,
  token,
  onDone,
}: {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onDone: () => void;
}) {
  // The parent remounts this dialog (via key) each time it opens, so the fields
  // start empty without a state-syncing effect.
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Set once the form is valid: the dialog then asks the question instead of
  // showing the fields, and holds exactly what will be sent.
  const [pending, setPending] = useState<ChangeUserEmailInput | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;
  const branch = user.branchName || 'No branch';

  function edit(field: Field, set: (v: string) => void, value: string) {
    set(value);
    setServerError(null);
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = ChangeUserEmailSchema.safeParse({ email, confirmEmail, reason: reason.trim() || undefined });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    if (parsed.data.email === user.email.trim().toLowerCase()) {
      setErrors({ email: 'This is already the user’s email address.' });
      return;
    }
    setErrors({});
    setServerError(null);
    setPending(parsed.data);
  }

  async function handleConfirm() {
    // `submitting` is also what disables the button; the check here is for the
    // second click that lands before React has painted it disabled.
    if (!user || !pending || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiCall<{ email: string }>(
        `/api/users/${user.id}/change-email`,
        { method: 'POST', body: JSON.stringify(pending) },
        token
      );
      toast.success(`Email address updated successfully for ${user.displayName}.`, {
        description: `They now sign in with ${res.email}.`,
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      // Back to the fields, with the reason: every refusal here (address taken,
      // unchanged, not valid) is fixed by typing a different address.
      setServerError(err instanceof Error ? err.message : 'The email address could not be changed.');
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Change email address</DialogTitle>
          <DialogDescription>
            The same account, with a new sign-in address. The password, branch and all existing records stay as they are.
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <>
            <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <p>
                Change the sign-in email for <span className="font-medium">{user.displayName}</span>{' '}
                (<span className="font-medium">{branch}</span>)?
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="break-all text-muted-foreground line-through">{user.email}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="break-all font-medium">{pending.email}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                From now on they sign in with the new address. The old one stops working for sign-in straight away.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPending(null)} disabled={submitting}>
                Back
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Changing…
                  </>
                ) : (
                  'Yes, change email'
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleReview} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>User</Label>
                <p className="truncate text-sm font-medium">{user.displayName}</p>
              </div>
              <div className="space-y-1">
                <Label>Branch</Label>
                <p className="truncate text-sm font-medium">{branch}</p>
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="change-email-current">Current email address</Label>
                <Input id="change-email-current" value={user.email} readOnly tabIndex={-1} className="bg-muted/40 text-muted-foreground" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="change-email-new">New email address</Label>
                <Input
                  id="change-email-new"
                  type="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  value={email}
                  onChange={(e) => edit('email', setEmail, e.target.value)}
                  placeholder="name@mountainbakes.com"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? 'change-email-new-error' : undefined}
                />
                <FieldError id="change-email-new-error" message={errors.email} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="change-email-confirm">Confirm new email address</Label>
                <Input
                  id="change-email-confirm"
                  type="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={confirmEmail}
                  onChange={(e) => edit('confirmEmail', setConfirmEmail, e.target.value)}
                  placeholder="Type it again"
                  aria-invalid={errors.confirmEmail ? true : undefined}
                  aria-describedby={errors.confirmEmail ? 'change-email-confirm-error' : undefined}
                />
                <FieldError id="change-email-confirm-error" message={errors.confirmEmail} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="change-email-reason">
                  Reason <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="change-email-reason"
                  rows={2}
                  maxLength={300}
                  value={reason}
                  onChange={(e) => edit('reason', setReason, e.target.value)}
                  placeholder="Saved with the change in User Activity"
                  aria-invalid={errors.reason ? true : undefined}
                  aria-describedby={errors.reason ? 'change-email-reason-error' : undefined}
                />
                <FieldError id="change-email-reason-error" message={errors.reason} />
              </div>
            </div>

            {serverError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Confirm Email Change</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
