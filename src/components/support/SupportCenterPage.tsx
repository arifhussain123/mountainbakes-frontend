'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import type { SupportTicket, SupportReference, SupportSaleItem, SupportSaleTotals, Product, PaymentMethod, StockFigures } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Eye, Pencil, SlidersHorizontal, Ban, Trash2, CheckCircle2, Plus, X, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { cn } from '@/lib/utils';

const col = createColumnHelper<SupportTicket>();

const STATUS_VARIANT: Record<SupportTicket['status'], 'default' | 'secondary' | 'destructive'> = {
  open: 'default',
  resolved: 'secondary',
  rejected: 'destructive',
};

// 'Demand' is a branch's production request (DMD-…), raised from the Production
// Help Desk. 'System' tickets are opened automatically when an unattended job fails
// (e.g. the 2 AM closing summary) — they carry no editable reference, only the
// failure detail. Both are read-only; see `canChange` below.
const TYPE_LABEL: Record<SupportReference['type'], string> = {
  sale: 'Sale',
  demand: 'Demand',
  expense: 'Expense',
  stock: 'Stock',
  system: 'System',
};

/** Read-only, type-aware detail table (auto-adjusts to whatever the reference is). */
function ReferenceDetail({ reference }: { reference: SupportReference }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
      <p className="text-sm font-semibold">{reference.title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {reference.fields.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="font-medium text-right">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The reference as it reads NOW.
 *
 * `referenceSnapshot` is frozen onto the ticket when the query is RAISED. That is
 * deliberate — it is what the raiser saw — but it means an older ticket keeps the
 * shorter field list its snapshot was written with, and never shows a correction
 * applied in between. So every dialog that displays a reference re-reads it, and
 * falls back to the snapshot if the read fails.
 *
 * A READ-ONLY reference is never re-read. A production pool or counter-sale ticket
 * has no branch ledger, and an admin's unscoped lookup of the same ID resolves to
 * an all-branches figure that does not describe it — the snapshot is the only
 * honest answer there.
 */
function useLiveReference(ticket: SupportTicket) {
  const { token } = useAuth();
  const snapshot = ticket.referenceSnapshot;
  const canRefresh = Boolean(snapshot) && snapshot?.readOnly !== true;
  const [reference, setReference] = useState<SupportReference | null>(snapshot);
  const [loading, setLoading] = useState(canRefresh);

  const branchId = ticket.branchId;
  const referenceId = ticket.referenceId;

  useEffect(() => {
    if (!token || !canRefresh) return;
    // branchId scopes a STOCK lookup to the raiser's branch (the server ignores it
    // for every other type); without it an admin gets an all-branches total.
    const url = `/api/support/lookup?ref=${encodeURIComponent(referenceId)}${branchId ? `&branchId=${branchId}` : ''}`;
    let cancelled = false;
    apiCall<{ reference: SupportReference }>(url, {}, token)
      .then((r) => { if (!cancelled) setReference(r.reference); })
      .catch(() => { /* keep the snapshot — it is still a truthful record of the query */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, canRefresh, referenceId, branchId]);

  return { reference, loading };
}

/**
 * A sale's lines, read-only — the same five columns the branch's Sale view shows
 * (product, qty, rate, discount, amount), so View answers "what was actually rung
 * up" without opening the editor. Scrolls inside itself on a narrow screen rather
 * than widening the dialog.
 */
function SaleItemsTable({ items }: { items: SupportSaleItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="p-2 font-semibold">Product</th>
            <th className="p-2 text-center font-semibold">Qty</th>
            <th className="p-2 text-right font-semibold">Rate</th>
            <th className="p-2 text-right font-semibold">Discount</th>
            <th className="p-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx} className="border-t">
              <td className="p-2">{it.productName}</td>
              <td className="p-2 text-center tabular-nums">{it.qty}</td>
              <td className="p-2 text-right tabular-nums">{money(it.unitPrice)}</td>
              <td className="p-2 text-right tabular-nums">{it.discount ? `-${money(it.discount)}` : '—'}</td>
              <td className="p-2 text-right font-medium tabular-nums">{money(it.unitPrice * it.qty - it.discount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DialogMode = 'view' | 'edit' | 'change' | 'reject' | null;

/** What /figures reports back when it applied a stock correction. */
interface StockCorrectionResult {
  applied: boolean;
  productName: string;
  before: StockFigures;
  after: StockFigures;
  movements: { type: string; delta: number }[];
}

export function SupportCenterPage() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [mode, setMode] = useState<DialogMode>(null);

  function reload() { setRefreshKey((k) => k + 1); }
  function openDialog(ticket: SupportTicket, m: DialogMode) { setActive(ticket); setMode(m); }
  function closeDialog() { setMode(null); setActive(null); }

  useEffect(() => {
    if (!token) return;
    apiCall<{ tickets: SupportTicket[] }>('/api/support', {}, token)
      .then((r) => setTickets(r.tickets))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load tickets'))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  async function handleDelete(ticket: SupportTicket) {
    if (!confirm(`Delete query ${ticket.ticketNumber}? This cannot be undone.`)) return;
    try {
      await apiCall(`/api/support/${ticket.id}`, { method: 'DELETE' }, token);
      toast.success('Query deleted');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  const openCount = useMemo(() => tickets.filter((t) => t.status === 'open').length, [tickets]);

  const columns = [
    col.accessor('ticketNumber', {
      header: 'Ticket',
      meta: { mobile: 'subtitle' },
      cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
    }),
    col.accessor('referenceId', {
      header: 'Reference',
      // What the ticket is *about* is the useful heading; its number is the
      // subtitle above.
      meta: { mobile: 'title' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Badge variant="outline">{TYPE_LABEL[row.original.referenceType]}</Badge>
          <span className="font-medium">{row.original.referenceId}</span>
        </div>
      ),
    }),
    col.accessor('branchName', {
      header: 'From',
      cell: ({ row }) => (
        <div className="text-sm">
          <p>{row.original.branchName || '—'}</p>
          <p className="text-xs text-muted-foreground capitalize">{(row.original.raisedByRole || '').replace('_', ' ')}</p>
        </div>
      ),
    }),
    col.accessor('message', {
      header: 'Issue',
      meta: { mobileFull: true },
      cell: (info) => <span className="text-sm line-clamp-2 max-w-[24rem]">{info.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (info) => <Badge variant={STATUS_VARIANT[info.getValue()]} className="capitalize">{info.getValue()}</Badge>,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const t = row.original;
        // Offer "Change figures" only where something can actually be changed. A
        // read-only reference (demand, production pool, counter sale) and a
        // 'system' ticket (no reference at all) are answered from View instead.
        //
        // Keyed on the snapshot's own flag rather than `editableFields.length`:
        // sales legitimately carry an empty editableFields (they are corrected
        // through saleItems), and legacy stock tickets with an empty one are still
        // routed by type into StockFiguresDialog, which re-reads live figures.
        // A length test would strand both. No stored snapshot has `readOnly`, so
        // this cannot regress an existing ticket.
        const canChange = Boolean(t.referenceSnapshot) && t.referenceSnapshot?.readOnly !== true;
        const changeTitle = canChange ? 'Change figures' : 'Nothing to correct — reply from View';
        return (
          <>
            {/* Desktop keeps the dense icon row. */}
            <div className="hidden items-center justify-end gap-0.5 md:flex">
              <IconBtn title="View" onClick={() => openDialog(t, 'view')}><Eye className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn title="Edit" onClick={() => openDialog(t, 'edit')}><Pencil className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn title={changeTitle} disabled={!canChange} onClick={() => openDialog(t, 'change')}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn title="Reject" className="text-amber-600" onClick={() => openDialog(t, 'reject')}><Ban className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn title="Delete" className="text-destructive" onClick={() => handleDelete(t)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
            </div>

            {/* On a phone five 44px targets are ~220px — more than half the screen
                — so they collapse into one menu, matching UsersPage. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Actions for ${t.ticketNumber}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
              >
                <MoreHorizontal className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openDialog(t, 'view')}><Eye className="h-4 w-4" /> View</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openDialog(t, 'edit')}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                <DropdownMenuItem disabled={!canChange} onClick={() => openDialog(t, 'change')}>
                  <SlidersHorizontal className="h-4 w-4" /> Change figures
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openDialog(t, 'reject')}><Ban className="h-4 w-4" /> Reject</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => handleDelete(t)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Support Center</h2>
          <p className="text-sm text-muted-foreground">
            {openCount} open · {tickets.length} total — resolve queries raised from branches & production.
          </p>
        </div>
      </div>

      <DataTable columns={columns} data={tickets} loading={loading} searchPlaceholder="Search tickets…" />

      {active && mode === 'view' && <ViewDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
      {active && mode === 'edit' && <EditDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
      {active && mode === 'change' && <ChangeDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
      {active && mode === 'reject' && <RejectDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
    </div>
  );
}

function IconBtn({ children, title, onClick, className, disabled }: { children: React.ReactNode; title: string; onClick: () => void; className?: string; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="icon" className={`h-8 w-8 ${className ?? ''}`} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

// --- View + Resolve --------------------------------------------------------
function ViewDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Live, so a sale query shows the full sale — customer, mobile, time, every
  // line's rate and discount, the money row — rather than the shorter snapshot an
  // older ticket was raised with.
  const { reference, loading } = useLiveReference(ticket);

  async function resolve() {
    setBusy(true);
    try {
      await apiCall(`/api/support/${ticket.id}/resolve`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolutionNote: note }) }, token);
      toast.success('Query resolved');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticket.ticketNumber}
            <Badge variant={STATUS_VARIANT[ticket.status]} className="capitalize">{ticket.status}</Badge>
          </DialogTitle>
          <DialogDescription>
            {ticket.referenceId} · from {ticket.branchName || ticket.raisedByName || '—'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {reference && <ReferenceDetail reference={reference} />}
          {/* A sale's lines, exactly as the branch's Sale view prints them. */}
          {reference?.saleItems && reference.saleItems.length > 0 && (
            <SaleItemsTable items={reference.saleItems} />
          )}
          {loading && <p className="text-xs text-muted-foreground">Re-reading the live record…</p>}
          <div>
            <Label className="text-xs text-muted-foreground">Issue</Label>
            <p className="text-sm">{ticket.message}</p>
          </div>
          {ticket.resolutionNote && (
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <Label className="text-xs text-muted-foreground">Resolution</Label>
              <p className="text-sm">{ticket.resolutionNote}</p>
            </div>
          )}
          {ticket.status === 'open' && (
            <div className="space-y-1">
              <Label>Resolution note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was done" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {ticket.status === 'open' && (
            <Button onClick={resolve} disabled={busy}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> {busy ? 'Resolving…' : 'Mark Resolved'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit ticket text ------------------------------------------------------
function EditDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [message, setMessage] = useState(ticket.message);
  const [note, setNote] = useState(ticket.resolutionNote ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiCall(`/api/support/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ message, resolutionNote: note }) }, token);
      toast.success('Ticket updated');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>Adjust the issue text or add an internal note.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Issue</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1">
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || message.trim().length < 3}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Sale line-items editor ------------------------------------------------
type EditRow = SupportSaleItem & { key: string };

const money = (n: number) => `Rs.${(Number.isFinite(n) ? n : 0).toLocaleString('en-PK')}`;
/**
 * Exactly as the server computes it (migration 26): rate × qty − line discount,
 * unclamped. A discount above the gross would make the line — and the sale —
 * negative, so it is rejected in `valid` below rather than hidden by a clamp that
 * would let the preview disagree with what gets written.
 */
const lineTotal = (r: EditRow) => r.unitPrice * r.qty - r.discount;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The sale's money row as the edits leave it — mirrors edit_sale_items. */
function previewTotals(rows: EditRow[], totals: SupportSaleTotals | undefined) {
  // Rounded at every step, as the numeric(14,2) columns behind these are — without
  // it a float artefact makes "Was …" claim a change of Rs.0.
  const gross = round2(rows.reduce((s, r) => s + r.unitPrice * r.qty, 0));
  const discountTotal = round2(rows.reduce((s, r) => s + r.discount, 0));
  const subtotal = round2(gross - discountTotal);
  const delivery = totals?.deliveryCharges ?? 0;
  const taxAmount = round2(subtotal * (totals?.taxRate ?? 0));
  return { gross, discountTotal, subtotal, delivery, taxAmount, grandTotal: round2(subtotal + delivery + taxAmount) };
}

/** One line-item input, self-labelling below `sm` where the header row is hidden. */
function LineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground sm:hidden">{label}</Label>
      {children}
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Search a product by SKU or name, case-insensitively (mirrors the POS form). */
function productMatchesQuery(p: Product | null, query: string): boolean {
  if (!p) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${p.sku} ${p.name}`.toLowerCase().includes(q);
}

function SaleItemsDialog({ ticket, reference: snapshot, onClose, onDone }: {
  ticket: SupportTicket;
  reference: SupportReference;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  // The ticket's snapshot is from when the query was RAISED — the sale may have
  // been corrected since, and a snapshot written before totals were carried has
  // no money row at all. So the live sale is re-read on open and the snapshot only
  // seeds the form until it lands.
  const { reference: live, loading } = useLiveReference(ticket);
  const reference = live ?? snapshot;
  const [rows, setRows] = useState<EditRow[]>(
    () => (snapshot.saleItems ?? []).map((it, i) => ({ ...it, key: `orig-${i}` })),
  );
  // Undefined when the snapshot predates payment editing, or when the sale carries
  // a legacy tender ('card' / 'online') that is no longer on offer — either way no
  // button is preselected and picking one is what sends the change.
  const [payment, setPayment] = useState<PaymentMethod | undefined>(snapshot.paymentMethod);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // A monotonic id so newly-added rows get stable React keys without Math.random.
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (!token) return;
    apiCall<{ products: Product[] }>('/api/products?isActive=true', {}, token)
      .then((r) => setProducts(r.products ?? []))
      .catch(() => toast.error('Could not load products'));
  }, [token]);

  // Reseed the form the moment the live sale lands. `live` is set exactly once, so
  // this cannot run again over an admin's half-finished edit.
  useEffect(() => {
    if (!live || live === snapshot) return;
    if (live.saleItems) setRows(live.saleItems.map((it, i) => ({ ...it, key: `live-${i}` })));
    setPayment(live.paymentMethod);
  }, [live, snapshot]);

  const totals = useMemo(() => previewTotals(rows, reference.saleTotals), [rows, reference.saleTotals]);

  function patchRow(key: string, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function pickProduct(key: string, p: Product | null) {
    if (!p) return;
    // Swapping the product resets the rate to that product's current price and
    // clears the discount — the old one was struck against a different item's
    // price, and silently carrying it over could exceed the new line's gross. The
    // admin can still set both afterward.
    patchRow(key, {
      productId: p.id,
      productName: p.name,
      categoryId: p.categoryId || null,
      categoryName: p.categoryName || null,
      unitPrice: Number(p.price ?? 0),
      discount: 0,
    });
  }
  function addRow() {
    const key = `new-${seq}`;
    setSeq((n) => n + 1);
    setRows((rs) => [...rs, { key, productId: null, productName: '', categoryId: null, categoryName: null, unitPrice: 0, qty: 1, discount: 0 }]);
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  // A discount above the line's gross would write a negative line total and drag
  // the sale below zero, so it is rejected here rather than clamped.
  const rowValid = (r: EditRow) =>
    Boolean(r.productId) && r.qty > 0 && r.unitPrice >= 0 && r.discount >= 0 && r.discount <= r.unitPrice * r.qty;
  const valid = rows.length > 0 && rows.every(rowValid);

  async function submit() {
    if (!valid) { toast.error('Every line needs a product, a quantity above 0, an amount, and a discount no bigger than the line'); return; }
    setBusy(true);
    try {
      const items = rows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        unitPrice: r.unitPrice,
        qty: r.qty,
        discount: r.discount,
      }));
      await apiCall(`/api/support/${ticket.id}/sale-items`, { method: 'PATCH', body: JSON.stringify({ items, paymentMethod: payment, note }) }, token);
      toast.success('Sale updated, stock adjusted & query resolved');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the sale');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit sale — {ticket.referenceId}</DialogTitle>
          <DialogDescription>
            The sale exactly as the branch sees it. Change a line’s product, quantity,
            rate, or discount, and the payment method. Edits apply to the order, its
            totals are recomputed and stock is reconciled automatically. The query is
            then resolved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {/* The branch's own sale detail — customer, mobile, date & time, money row,
              tender, status, who sold it — so both sides read one document. */}
          <ReferenceDetail reference={reference} />
          {loading && <p className="text-xs text-muted-foreground">Re-reading the live sale…</p>}

          <div className="hidden sm:grid grid-cols-[1fr_4.5rem_6rem_6rem_6rem_2rem] gap-2 px-1 pt-1 text-xs text-muted-foreground">
            <span>Product</span><span className="text-right">Qty</span>
            <span className="text-right">Rate (each)</span><span className="text-right">Discount</span>
            <span className="text-right">Amount</span><span />
          </div>

          {rows.map((r) => {
            const selected = products.find((p) => p.id === r.productId) ?? null;
            const discountTooBig = r.discount > r.unitPrice * r.qty || r.discount < 0;
            return (
              <div key={r.key} className="grid grid-cols-1 sm:grid-cols-[1fr_4.5rem_6rem_6rem_6rem_2rem] gap-2 items-center">
                <Combobox
                  items={products}
                  filter={productMatchesQuery}
                  value={selected}
                  onValueChange={(p: Product | null) => pickProduct(r.key, p)}
                  itemToStringLabel={(p: Product) => `${p.sku} — ${p.name}`}
                  itemToStringValue={(p: Product) => p.id}
                  isItemEqualToValue={(a: Product, b: Product) => a?.id === b?.id}
                >
                  <ComboboxInput placeholder={r.productName || 'Search product…'} />
                  <ComboboxContent>
                    <ComboboxEmpty>No products found.</ComboboxEmpty>
                    <ComboboxList>
                      {(p: Product) => (
                        <ComboboxItem key={p.id} value={p}>
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium">{p.sku} · {p.name}</span>
                            <span className="text-xs text-muted-foreground">{p.categoryName} · {money(p.price)}</span>
                          </div>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>

                {/* The column headers only exist from `sm` up, so each field states
                    itself on a phone rather than being three anonymous number boxes. */}
                <LineField label="Qty">
                  <Input
                    type="number" min="0" step="0.001" inputMode="decimal"
                    className="text-right"
                    value={r.qty}
                    onChange={(e) => patchRow(r.key, { qty: Number(e.target.value) })}
                  />
                </LineField>
                <LineField label="Rate (each)">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="text-right"
                    value={r.unitPrice}
                    onChange={(e) => patchRow(r.key, { unitPrice: Number(e.target.value) })}
                  />
                </LineField>
                <LineField label="Discount">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className={cn('text-right', discountTooBig && 'border-destructive')}
                    value={r.discount}
                    onChange={(e) => patchRow(r.key, { discount: Number(e.target.value) })}
                  />
                </LineField>
                <span className="text-right text-sm tabular-nums">
                  <span className="sm:hidden text-xs text-muted-foreground mr-2">Amount</span>
                  {money(lineTotal(r))}
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                  title="Remove line" onClick={() => removeRow(r.key)} disabled={rows.length <= 1}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Add item
          </Button>

          {rows.some((r) => r.discount > r.unitPrice * r.qty || r.discount < 0) && (
            <p className="text-xs text-destructive">
              A line’s discount cannot be more than its qty × rate.
            </p>
          )}

          {/* The same money row the branch's Sale view prints, recomputed from the
              edits — tax rate and delivery come from the order, so this is what
              edit_sale_items will write. */}
          <div className="ml-auto w-full max-w-xs space-y-1.5 pt-1 text-sm">
            <TotalRow label="Subtotal" value={money(totals.gross)} />
            <TotalRow label="Discount" value={`-${money(totals.discountTotal)}`} />
            {totals.delivery > 0 && <TotalRow label="Delivery" value={money(totals.delivery)} />}
            <TotalRow label="Government Tax" value={money(totals.taxAmount)} />
            <div className="flex justify-between border-t pt-1.5 text-base font-bold">
              <span>Grand Total</span>
              <span className="text-primary tabular-nums">{money(totals.grandTotal)}</span>
            </div>
            {reference.saleTotals && totals.grandTotal !== reference.saleTotals.grandTotal && (
              <p className="text-right text-xs text-muted-foreground">
                Was {money(reference.saleTotals.grandTotal)}.
              </p>
            )}
          </div>

          {/* Payment method — same radio-button group as the POS sale form. */}
          <div className="space-y-2 pt-1">
            <Label>Payment Method</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayment(m)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    payment === m ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
                  )}
                >
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
            {reference.paymentMethod && payment !== reference.paymentMethod && (
              <p className="text-xs text-muted-foreground">
                Was {PAYMENT_METHOD_LABELS[reference.paymentMethod] ?? reference.paymentMethod}.
              </p>
            )}
          </div>

          <div className="space-y-1 pt-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for the change" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !valid}>{busy ? 'Applying…' : 'Apply & Resolve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Change figures — dispatches to the editor the reference deserves. ----------
// Pure dispatcher, deliberately hook-free: each branch is a component with its own
// state, so no hook is ever called conditionally.
function ChangeDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const ref = ticket.referenceSnapshot;

  // Belt and braces behind the disabled button above — a stale client could still
  // reach here. Without this, FieldEditDialog's no-editable-fields fallback would
  // render the reference's DISPLAY fields as editable inputs and resolve the ticket
  // with a "Correction recorded (manual follow-up)" note that corrected nothing.
  // The server rejects the PATCH regardless; this keeps the UI honest.
  if (!ref || ref.readOnly) {
    return <NothingToChangeDialog onClose={onClose} />;
  }
  // Sales get a dedicated line-item editor (change product / qty / amount, add /
  // remove lines) applied live to the order with stock reconciled server-side.
  if (ref?.type === 'sale' && ref.saleItems) {
    return <SaleItemsDialog ticket={ticket} reference={ref} onClose={onClose} onDone={onDone} />;
  }
  // Stock gets the whole derived row — Opening / New / Sold / Returned / Balance —
  // with every correctable figure editable and applied to the branch's ledger.
  if (ref?.type === 'stock') {
    return <StockFiguresDialog ticket={ticket} onClose={onClose} onDone={onDone} />;
  }
  return <FieldEditDialog ticket={ticket} onClose={onClose} onDone={onDone} />;
}

/**
 * Terminal state for a reference that carries nothing correctable — a demand, the
 * production stock pool, a Production counter sale, or a 'system' ticket. Answering
 * it is a resolution note, which lives in View.
 */
function NothingToChangeDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Nothing to correct</DialogTitle>
          <DialogDescription>
            This reference is informational only — there is no figure here that can be written
            back. Open <span className="font-medium">View</span> to reply and resolve the query.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only figure row inside the stock editor. */
function FigureRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums font-medium">
        {value}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

const STOCK_FIELDS = [
  { key: 'newQty', label: 'New Stock', hint: 'units received from Production' },
  { key: 'sold', label: 'Sold', hint: 'units sold today' },
  { key: 'returned', label: 'Returned', hint: 'units sent back to Production' },
] as const;

/**
 * Stock correction. Shows the branch's LIVE derived row (the ticket's snapshot is
 * from when the query was raised) and lets the admin set each correctable figure to
 * what it should read. The server sizes a compensating movement per figure, so the
 * branch's Stock page reflects the correction immediately.
 *
 * Opening is read-only: it is the previous day's closing, and correcting it would
 * mean rewriting a day that has already been closed.
 *
 * Balance follows the other three automatically, so the row always adds up. Typing
 * a Balance overrides that, and the leftover difference is booked as an adjustment
 * — which is the plain "my shelf count disagrees with the system" case.
 */
function StockFiguresDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [figures, setFigures] = useState<StockFigures | null>(null);
  // Starts false when there is nothing to fetch, so the effect never has to
  // synchronously flip it back and trigger a cascading render.
  const [loading, setLoading] = useState(Boolean(ticket.branchId));
  const [targets, setTargets] = useState<Record<string, string>>({});
  // Until the admin edits Balance themselves, it tracks the other three figures.
  const [balanceTouched, setBalanceTouched] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const productName = ticket.referenceSnapshot?.fields.find((f) => f.label === 'Product')?.value ?? ticket.referenceId;

  useEffect(() => {
    if (!token || !ticket.branchId) return;
    // Scoped to the ticket's branch: an admin's unscoped stock lookup is an
    // all-branches total, which is not a ledger anything can be applied to.
    apiCall<{ reference: SupportReference }>(
      `/api/support/lookup?ref=${encodeURIComponent(ticket.referenceId)}&branchId=${ticket.branchId}`,
      {},
      token,
    )
      .then((r) => {
        const f = r.reference.stockFigures;
        if (!f) { toast.error('Could not read this branch’s stock figures'); return; }
        setFigures(f);
        setTargets({
          newQty: String(f.newQty),
          sold: String(f.sold),
          returned: String(f.returned),
          balance: String(f.balance),
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load current stock'))
      .finally(() => setLoading(false));
  }, [token, ticket.branchId, ticket.referenceId]);

  const num = (v: string | undefined) => Number(v ?? 0);

  /**
   * Balance implied by the figures as typed. Mirrors the server's definition
   * (opening + new − sold − returned + adjustment), carrying over any adjustment
   * already recorded today so an earlier correction is not silently undone.
   */
  const implied = useMemo(() => {
    if (!figures) return 0;
    return figures.opening + num(targets['newQty']) - num(targets['sold']) - num(targets['returned']) + figures.adjustment;
  }, [figures, targets]);

  // The extra adjustment the typed Balance would book on top of the other edits.
  const extraAdjustment = balanceTouched ? num(targets['balance']) - implied : 0;
  const finalBalance = balanceTouched ? num(targets['balance']) : implied;

  function setFigure(key: string, value: string) {
    setTargets((t) => ({ ...t, [key]: value }));
    if (key === 'balance') setBalanceTouched(true);
  }

  // Keep Balance showing the implied result while the admin has not overridden it.
  const shownBalance = balanceTouched ? (targets['balance'] ?? '') : String(implied);

  const invalid =
    ['newQty', 'sold', 'returned'].some((k) => {
      const v = num(targets[k]);
      return targets[k] === '' || !Number.isFinite(v) || v < 0;
    }) ||
    // A cleared Balance is not "zero" — it is no figure at all, and would otherwise
    // submit as a count of 0.
    (balanceTouched && targets['balance'] === '') ||
    finalBalance < 0;

  /**
   * Only the figures the admin actually moved. Sending an untouched figure would
   * be a lost update: it is an absolute target, so a sale rung up between opening
   * this dialog and applying it would be silently reverted. An omitted figure is
   * left alone by the server, so concurrent movements survive.
   *
   * Balance is sent only when the admin typed one that differs from what the other
   * edits already imply — that is the "my shelf count disagrees" case, where
   * overriding whatever else moved is exactly the intent.
   */
  const edits = useMemo(() => {
    if (!figures) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const k of ['newQty', 'sold', 'returned'] as const) {
      if (num(targets[k]) !== figures[k]) out[k] = num(targets[k]);
    }
    if (balanceTouched && num(targets['balance']) !== implied) out['balance'] = num(targets['balance']);
    return out;
  }, [figures, targets, balanceTouched, implied]);

  const changed = Object.keys(edits).length > 0;

  async function submit() {
    if (invalid) { toast.error('Every figure must be 0 or more'); return; }
    if (!changed) { toast.error('Change at least one figure'); return; }
    setBusy(true);
    try {
      const res = await apiCall<{ applied: boolean; stock: StockCorrectionResult | null }>(
        `/api/support/${ticket.id}/figures`,
        { method: 'PATCH', body: JSON.stringify({ edits, note }) },
        token,
      );
      toast.success(
        res.stock?.applied
          ? `Branch stock corrected — balance ${res.stock.before.balance} → ${res.stock.after.balance}`
          : 'Branch stock already matched — query resolved',
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to correct the stock');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Correct stock — {ticket.referenceId}</DialogTitle>
          <DialogDescription>
            {productName}{ticket.branchName ? ` · ${ticket.branchName}` : ''} — set each figure to
            what it should read. The branch’s stock is adjusted to match and the query
            is resolved.
          </DialogDescription>
        </DialogHeader>

        {!ticket.branchId ? (
          <p className="text-sm text-muted-foreground">
            This query was not raised from a branch, so there is no branch stock to
            correct. Resolve or reject it instead.
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading current stock…</p>
        ) : !figures ? (
          <p className="text-sm text-muted-foreground">Current stock is unavailable.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
              <FigureRow label="Opening Stock" value={String(figures.opening)} hint="carried from yesterday" />
              {figures.adjustment !== 0 && (
                <FigureRow
                  label="Adjustment so far"
                  value={figures.adjustment > 0 ? `+${figures.adjustment}` : String(figures.adjustment)}
                  hint="earlier corrections today"
                />
              )}
            </div>

            {STOCK_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label>{f.label}</Label>
                  <span className="text-xs text-muted-foreground">
                    now {figures[f.key]} · {f.hint}
                  </span>
                </div>
                <Input
                  type="number" min="0" step="0.001" inputMode="decimal"
                  className="text-right"
                  value={targets[f.key] ?? ''}
                  onChange={(e) => setFigure(f.key, e.target.value)}
                />
              </div>
            ))}

            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <Label>Balance</Label>
                <span className="text-xs text-muted-foreground">
                  now {figures.balance} · {balanceTouched ? 'set by hand' : 'follows the figures above'}
                </span>
              </div>
              <Input
                type="number" min="0" step="0.001" inputMode="decimal"
                className={cn('text-right', finalBalance < 0 && 'border-destructive')}
                value={shownBalance}
                onChange={(e) => setFigure('balance', e.target.value)}
              />
              {extraAdjustment !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Booked as an adjustment of {extraAdjustment > 0 ? `+${extraAdjustment}` : extraAdjustment}.
                </p>
              )}
              {finalBalance < 0 && (
                <p className="text-xs text-destructive">A branch balance cannot go below zero.</p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Correcting <strong>Sold</strong> moves stock only — it does not change the
              day’s takings or payment method. For a sale recorded wrongly, raise the
              query against its sale ID (MB-…) instead, which corrects the order, its
              total and its tender along with the stock.
            </p>

            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for the correction" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || loading || !figures || invalid || !changed}>
            {busy ? 'Applying…' : 'Apply & Resolve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Flat field edit — expenses (live) and anything with no correctable figure ---
function FieldEditDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const ref = ticket.referenceSnapshot;

  const isLiveEdit = (ref?.editableFields.length ?? 0) > 0;

  // Editable rows: the expense's editableFields, or — when nothing here can be
  // written directly — the display fields, captured as a recorded correction.
  const rows = useMemo(() => {
    if (!ref) return [] as { key: string; label: string; value: string }[];
    return isLiveEdit
      ? ref.editableFields.map((f) => ({ key: f.key, label: f.label, value: String(f.value) }))
      : ref.fields.map((f) => ({ key: f.label, label: f.label, value: f.value }));
  }, [ref, isLiveEdit]);

  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r.value])), [rows]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    // Only send fields the admin actually changed.
    const edits: Record<string, string> = {};
    for (const r of rows) if (values[r.key] !== initial[r.key]) edits[r.key] = values[r.key];
    if (Object.keys(edits).length === 0) { toast.error('Change at least one value'); return; }
    setBusy(true);
    try {
      const res = await apiCall<{ applied: boolean }>(
        `/api/support/${ticket.id}/figures`,
        { method: 'PATCH', body: JSON.stringify({ edits, note }) },
        token,
      );
      toast.success(res.applied ? 'Figures updated & query resolved' : 'Correction recorded & query resolved');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply change');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change figures — {ticket.referenceId}</DialogTitle>
          <DialogDescription>
            {isLiveEdit
              ? 'Edits are written directly to the record and the query is resolved.'
              : 'This reference has no directly correctable figure, so the change is recorded on the ticket for manual follow-up.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {rows.map((r) => {
            const editable = !isLiveEdit || ref!.editableFields.some((f) => f.key === r.key);
            return (
              <div key={r.key} className="space-y-1">
                <Label>{r.label}</Label>
                <Input
                  value={values[r.key] ?? ''}
                  disabled={!editable}
                  onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                />
              </div>
            );
          })}
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for the change" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Applying…' : 'Apply & Resolve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Reject ----------------------------------------------------------------
function RejectDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function reject() {
    setBusy(true);
    try {
      await apiCall(`/api/support/${ticket.id}/resolve`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', resolutionNote: note }) }, token);
      toast.success('Query rejected');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>Let the raiser know why this query is being rejected.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why this can't be actioned" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={reject} disabled={busy}>{busy ? 'Rejecting…' : 'Reject Query'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
