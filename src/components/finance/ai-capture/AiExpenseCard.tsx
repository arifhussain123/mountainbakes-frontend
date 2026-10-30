'use client';

import { useState } from 'react';
import {
  AI_EXPENSE_ISSUE_LABELS,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  type FinanceAccount,
  type FinancePaymentMethod,
  type LedgerHead,
} from '@mb/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Money } from '@/components/finance/finance-ui';
import { cn } from '@/lib/utils';
import {
  Check, ChevronDown, ChevronUp, Combine, Eye, Loader2, Pencil, RotateCcw, Scissors, Trash2, TriangleAlert,
} from 'lucide-react';
import { missingFields, type AiDraft } from './aiCaptureDraft';

const NO_BRANCH = '__none__';

export type CardAction = 'delete' | 'split' | 'regenerate' | { combineWith: string };

/**
 * One proposed expense. Collapsed it reads like the entry it will become;
 * expanded (Edit) every field the entry form has can be changed. Approve marks
 * it ready — the page's Save Approved saves it — and is refused while anything
 * required is missing or a possible duplicate has not been checked.
 */
export function AiExpenseCard({
  draft,
  index,
  heads,
  branches,
  thumbs,
  combineOptions,
  busy,
  onChange,
  onApprove,
  onAction,
  onViewReceipt,
}: {
  draft: AiDraft;
  index: number;
  heads: LedgerHead[];
  branches: { id: string; name: string }[];
  /** Preview URL by attachment id, for the receipt thumbnails. */
  thumbs: Map<string, string>;
  combineOptions: { key: string; label: string }[];
  /** The page is reading or saving: actions wait. */
  busy: boolean;
  onChange: (patch: Partial<AiDraft>) => void;
  onApprove: (approved: boolean) => void;
  onAction: (action: CardAction) => void;
  onViewReceipt: () => void;
}) {
  const saved = draft.status === 'saved';
  const [open, setOpen] = useState(!saved && (draft.needsReview || missingFields(draft).length > 0));
  const missing = missingFields(draft);
  const locked = saved || draft.status === 'saving' || busy;
  const headName = heads.find((h) => h.id === draft.ledgerHeadId)?.name;
  const amount = Number(draft.amount);

  const statusBadge = saved ? (
    <Badge className="bg-emerald-600 text-white">Saved · {draft.savedTxnNo}</Badge>
  ) : draft.status === 'saving' ? (
    <Badge variant="secondary"><Loader2 className="size-3 animate-spin" /> Saving…</Badge>
  ) : draft.status === 'approved' ? (
    <Badge className="bg-primary/90">Approved</Badge>
  ) : draft.needsReview || missing.length > 0 ? (
    <Badge variant="destructive">Needs review</Badge>
  ) : (
    <Badge variant="secondary">AI extracted</Badge>
  );

  return (
    <article
      className={cn(
        'rounded-xl border bg-card shadow-xs',
        saved && 'border-emerald-300 dark:border-emerald-900',
        draft.status === 'approved' && 'border-primary/60',
      )}
    >
      <header className="flex items-start gap-3 p-3 sm:p-4">
        <button type="button" onClick={onViewReceipt} className="shrink-0" aria-label={`Expense ${index + 1}: view receipt`}>
          <div className="relative size-14 overflow-hidden rounded-md border bg-muted sm:size-16">
            {thumbs.get(draft.photoIds[0] ?? '') && (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL or a signed URL
              <img src={thumbs.get(draft.photoIds[0]!)} alt="" className="size-full object-cover" />
            )}
            {draft.photoIds.length > 1 && (
              <span className="absolute bottom-0 right-0 rounded-tl bg-background/90 px-1 text-[10px] font-medium">+{draft.photoIds.length - 1}</span>
            )}
          </div>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Expense {String(index + 1).padStart(2, '0')}</span>
            {statusBadge}
            {draft.confidence !== 'high' && !saved && (
              <Badge variant="outline" className="text-[11px]">AI confidence: {draft.confidence}</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate font-medium" title={draft.description}>{draft.description || 'No description'}</p>
          {draft.descriptionOriginal && (
            <p className="truncate text-sm text-muted-foreground" dir="auto" title={draft.descriptionOriginal}>{draft.descriptionOriginal}</p>
          )}
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <div><dt className="inline">Date: </dt><dd className="inline text-foreground">{draft.businessDate || '—'}</dd></div>
            <div><dt className="inline">Amount: </dt><dd className="inline font-medium text-foreground">{draft.amount.trim() && Number.isFinite(amount) ? <Money value={amount} /> : '—'}</dd></div>
            <div><dt className="inline">Method: </dt><dd className="inline text-foreground">{FINANCE_PAYMENT_METHOD_LABELS[draft.paymentMethod]}</dd></div>
            {headName && <div><dt className="inline">Head: </dt><dd className="inline text-foreground">{headName}</dd></div>}
          </dl>
        </div>
        {!saved && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Collapse' : 'Edit'} aria-expanded={open}>
            {open ? <ChevronUp /> : <ChevronDown />}
          </Button>
        )}
      </header>

      {!saved && (draft.issues.length > 0 || draft.aiNotes || draft.duplicates.length > 0 || draft.error) && (
        <div className="space-y-1.5 px-3 pb-3 sm:px-4">
          {draft.error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {draft.error}
            </p>
          )}
          {draft.issues.map((i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {AI_EXPENSE_ISSUE_LABELS[i]}
            </p>
          ))}
          {draft.aiNotes && <p className="text-xs text-muted-foreground" dir="auto">AI note: {draft.aiNotes}</p>}
          {draft.duplicates.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-medium">Possible duplicate</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {draft.duplicates.map((d, i) => <li key={i}>{d.message}</li>)}
              </ul>
              <label className="mt-1.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.duplicateAcknowledged}
                  disabled={locked}
                  onChange={(e) => onChange({ duplicateAcknowledged: e.target.checked })}
                />
                I have checked: this is a different expense
              </label>
            </div>
          )}
        </div>
      )}

      {open && !saved && (
        <div className="space-y-3 border-t p-3 sm:p-4">
          <div className="space-y-1">
            <Label>Ledger head</Label>
            <Select value={draft.ledgerHeadId} onValueChange={(v) => onChange({ ledgerHeadId: (v as string) ?? '' })} disabled={locked}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select an expense head" /></SelectTrigger>
              <SelectContent>
                {heads.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{h.name}{h.groupName ? ` · ${h.groupName}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Business date</Label>
              <Input type="date" value={draft.businessDate} disabled={locked} onChange={(e) => onChange({ businessDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00"
                value={draft.amount} disabled={locked}
                onChange={(e) => onChange({ amount: e.target.value })}
              />
            </div>
          </div>
          {draft.billTotal !== null && Number(draft.amount) !== draft.billTotal && (
            <p className="text-xs text-muted-foreground">The bill total read was <Money value={draft.billTotal} />.</p>
          )}
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={draft.description} maxLength={300} disabled={locked} onChange={(e) => onChange({ description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={draft.paymentMethod} onValueChange={(v) => onChange({ paymentMethod: v as FinancePaymentMethod })} disabled={locked}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FINANCE_PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{FINANCE_PAYMENT_METHOD_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Account</Label>
              <Select value={draft.account} onValueChange={(v) => onChange({ account: v as FinanceAccount })} disabled={locked}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FINANCE_ACCOUNT_LABELS) as FinanceAccount[]).map((a) => <SelectItem key={a} value={a}>{FINANCE_ACCOUNT_LABELS[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Branch</Label>
              <Select value={draft.branchId ?? NO_BRANCH} onValueChange={(v) => onChange({ branchId: v === NO_BRANCH ? null : (v as string) })} disabled={locked}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BRANCH}>Not for a branch</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reference</Label>
              <Input value={draft.referenceNo} maxLength={80} placeholder="Invoice no." disabled={locked} onChange={(e) => onChange({ referenceNo: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={3} maxLength={500} value={draft.notes} disabled={locked} onChange={(e) => onChange({ notes: e.target.value })} />
          </div>
          {draft.lineItems.length > 0 && (
            <details className="rounded-md border px-3 py-2 text-sm">
              <summary className="cursor-pointer text-xs font-medium">Bill items ({draft.lineItems.length}) — kept as detail, not separate expenses</summary>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {draft.lineItems.map((l, i) => (
                    <tr key={i} className="border-t first:border-t-0">
                      <td className="py-1 pr-2" dir="auto">
                        {l.description}
                        {l.descriptionEnglish && <span className="block text-muted-foreground">{l.descriptionEnglish}</span>}
                      </td>
                      <td className="py-1 pr-2 text-center tabular-nums text-muted-foreground">{l.quantity ?? ''}</td>
                      <td className="py-1 text-right tabular-nums">{l.amount !== null ? <Money value={l.amount} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {!saved && (
        <footer className="flex flex-wrap items-center gap-1.5 border-t p-2 sm:px-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}><Pencil /> {open ? 'Done' : 'Edit'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onViewReceipt}><Eye /> Receipt</Button>
          <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => onAction('regenerate')}><RotateCcw /> Regenerate</Button>
          <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => onAction('split')}><Scissors /> Split</Button>
          {combineOptions.length > 0 && (
            <Select value="" onValueChange={(v) => v && onAction({ combineWith: v as string })} disabled={locked}>
              <SelectTrigger size="sm" className="h-7 w-auto border-0 shadow-none"><Combine className="size-3.5" /><SelectValue placeholder="Combine" /></SelectTrigger>
              <SelectContent>
                {combineOptions.map((o) => <SelectItem key={o.key} value={o.key}>With {o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={locked} onClick={() => onAction('delete')}><Trash2 /> Delete</Button>
          <span className="ml-auto" />
          {draft.status === 'approved' ? (
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => onApprove(false)}>Undo approve</Button>
          ) : (
            <Button
              type="button" size="sm" disabled={locked || missing.length > 0} onClick={() => onApprove(true)}
              title={missing.length > 0 ? `Still needed: ${missing.join(', ')}` : undefined}
            >
              <Check /> Approve
            </Button>
          )}
          {missing.length > 0 && draft.status !== 'saving' && (
            <p className="w-full text-right text-[11px] text-muted-foreground">Still needed: {missing.join(', ')}</p>
          )}
        </footer>
      )}
    </article>
  );
}
