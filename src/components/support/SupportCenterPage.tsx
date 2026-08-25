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
import type { SupportTicket, SupportReference, SupportSaleItem, SupportSaleTotals, SupportDemandItem, Product, PaymentMethod, StockFigures, ProductionStockFigures } from '@mb/shared';
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
// Help Desk; it is corrected through DemandItemsDialog. 'System' tickets are opened
// automatically when an unattended job fails (e.g. the 2 AM closing summary) — they
// carry no editable reference, only the failure detail, so they stay read-only;
// see `canChange` below.
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
 * Is this stock ticket about the central production pool rather than a branch?
 *
 * The snapshot's own flag when it has one; otherwise the raiser's role, which is
 * equally decisive — a production user's stock lookup has only ever resolved to the
 * pool. The fallback is what makes tickets raised BEFORE the pool became correctable
 * (they carry `readOnly: true` and no flag) correctable now. Mirrors the same test
 * on the server, which is the one that actually authorises the write.
 */
function isPoolStockTicket(ticket: SupportTicket): boolean {
  if (ticket.referenceType !== 'stock') return false;
  return ticket.referenceSnapshot?.isProductionPool === true || ticket.raisedByRole === 'production_user';
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
 * Read-only references are not re-read — a demand or a counter sale has nothing to
 * correct, and re-reading buys nothing. A POOL ticket is re-read even when its
 * (legacy) snapshot says read-only, because that flag is now out of date.
 */
function useLiveReference(ticket: SupportTicket) {
  const { token } = useAuth();
  const snapshot = ticket.referenceSnapshot;
  const isPool = isPoolStockTicket(ticket);
  const canRefresh = Boolean(snapshot) && (snapshot?.readOnly !== true || isPool);
  const [reference, setReference] = useState<SupportReference | null>(snapshot);
  const [loading, setLoading] = useState(canRefresh);

  const branchId = ticket.branchId;
  const referenceId = ticket.referenceId;

  useEffect(() => {
    if (!token || !canRefresh) return;
    // A stock lookup has to be told WHICH ledger: `pool=1` for the production pool,
    // `branchId` for the raiser's branch. With neither, an admin's stock lookup
    // resolves to an all-branches total, which is not a ledger anything can be
    // applied to. The pool wins — a pool ticket has no branch to fall back on, even
    // when the production account that raised it happens to carry one.
    const scope = isPool ? '&pool=1' : branchId ? `&branchId=${branchId}` : '';
    const url = `/api/support/lookup?ref=${encodeURIComponent(referenceId)}${scope}`;
    let cancelled = false;
    apiCall<{ reference: SupportReference }>(url, {}, token)
      .then((r) => { if (!cancelled) setReference(r.reference); })
      .catch(() => { /* keep the snapshot — it is still a truthful record of the query */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, canRefresh, referenceId, branchId, isPool]);

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

  // Archives rather than deletes (migration 76). The row survives — it is the only
  // record of what was asked and how it was answered, and corrections applied from
  // it carry its id in stock_history.ref_id. It just leaves the queue.
  async function handleArchive(ticket: SupportTicket) {
    if (!confirm(`Archive query ${ticket.ticketNumber}? It leaves the list but is kept on record.`)) return;
    try {
      await apiCall(`/api/support/${ticket.id}`, { method: 'DELETE' }, token);
      toast.success('Query archived');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive');
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
        // read-only reference (production pool, counter sale, a rejected or
        // cancelled demand) and a 'system' ticket (no reference at all) are
        // answered from View instead.
        //
        // Keyed on the snapshot's own flag rather than `editableFields.length`:
        // sales legitimately carry an empty editableFields (they are corrected
        // through saleItems), and legacy stock tickets with an empty one are still
        // routed by type into StockFiguresDialog, which re-reads live figures.
        // A length test would strand both.
        //
        // A POOL ticket overrides the flag: production stock became correctable
        // (migration 50) after those snapshots were frozen with `readOnly: true`,
        // and the dialog re-reads the pool live before writing anything.
        //
        // A DEMAND likewise overrides it: a rejected/cancelled demand still has
        // no correctable lines, but it can now be deleted (migration 82), and
        // the dialog router sends it straight to the delete confirmation. Left
        // disabled it would be the one demand an admin cannot remove.
        const canChange =
          Boolean(t.referenceSnapshot) &&
          (t.referenceSnapshot?.readOnly !== true ||
            isPoolStockTicket(t) ||
            t.referenceType === 'demand');
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
              <IconBtn title="Archive" className="text-destructive" onClick={() => handleArchive(t)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
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
                <DropdownMenuItem variant="destructive" onClick={() => handleArchive(t)}>
                  <Trash2 className="h-4 w-4" /> Archive
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
      {/* Wider than the other dialogs, and the body scrolls inside itself: a sale
          reference is a five-column item table under a dozen detail rows, which
          would otherwise push the footer buttons off the bottom of the popup. */}
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticket.ticketNumber}
            <Badge variant={STATUS_VARIANT[ticket.status]} className="capitalize">{ticket.status}</Badge>
          </DialogTitle>
          <DialogDescription>
            {ticket.referenceId} · from {ticket.branchName || ticket.raisedByName || '—'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
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

  // Reseed the form the moment the live sale lands — React's "adjust state when a
  // value changes" pattern, during render rather than in an effect, so there is no
  // extra commit showing the snapshot's lines. `seededFrom` makes it run exactly
  // once per reference, never over an admin's half-finished edit.
  const [seededFrom, setSeededFrom] = useState<SupportReference | null>(snapshot);
  if (live && live !== seededFrom) {
    setSeededFrom(live);
    if (live.saleItems) setRows(live.saleItems.map((it, i) => ({ ...it, key: `live-${i}` })));
    setPayment(live.paymentMethod);
  }

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

  // The production pool, checked BEFORE the read-only gate: a legacy pool snapshot
  // still says read-only, and the pool editor re-reads it live anyway.
  if (ref && isPoolStockTicket(ticket)) {
    return <ProductionStockFiguresDialog ticket={ticket} onClose={onClose} onDone={onDone} />;
  }
  // Belt and braces behind the disabled button above — a stale client could still
  // reach here. Without this, FieldEditDialog's no-editable-fields fallback would
  // render the reference's DISPLAY fields as editable inputs and resolve the ticket
  // with a "Correction recorded (manual follow-up)" note that corrected nothing.
  // The server rejects the PATCH regardless; this keeps the UI honest.
  // A rejected or cancelled demand still cannot have its LINES corrected — that
  // would produce a document claiming a commitment nobody made, which is why
  // migration 77 refuses it. It can be deleted, though: deleting asserts
  // nothing, and such a demand moved no stock, so the reversal comes back empty.
  // Routing it here rather than to the dead-end below is what makes "the admin
  // can delete any demand" true.
  if (ref?.type === 'demand' && ref.readOnly) {
    return (
      <DeleteDemandDialog
        ticket={ticket}
        stockMoved={ref.demandStockMoved === true}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }
  if (!ref || ref.readOnly) {
    return <NothingToChangeDialog onClose={onClose} />;
  }
  // Sales get a dedicated line-item editor (change product / qty / amount, add /
  // remove lines) applied live to the order with stock reconciled server-side.
  if (ref?.type === 'sale' && ref.saleItems) {
    return <SaleItemsDialog ticket={ticket} reference={ref} onClose={onClose} onDone={onDone} />;
  }
  // Demands get their own line editor: two quantities per line rather than a
  // price, and whether a change moves stock depends on delivery, not status.
  if (ref?.type === 'demand' && ref.demandItems) {
    return <DemandItemsDialog ticket={ticket} reference={ref} onClose={onClose} onDone={onDone} />;
  }
  // Stock gets the whole derived row — Opening / New / Sold / Returned / Balance —
  // with every correctable figure editable and applied to the branch's ledger.
  if (ref?.type === 'stock') {
    return <StockFiguresDialog ticket={ticket} onClose={onClose} onDone={onDone} />;
  }
  return <FieldEditDialog ticket={ticket} onClose={onClose} onDone={onDone} />;
}

// --- Demand line editor ----------------------------------------------------
type DemandRow = SupportDemandItem & { key: string };

/**
 * Edits a demand's product lines. Two quantities per line, and they mean
 * different things: `qty` is what the branch asked for (a record of the request)
 * and `approvedQty` is what Production granted — the only one that ever moves
 * stock, at verification.
 *
 * So the warning below is not decoration. If this demand already delivered, a
 * change to Approved is a change to inventory that is physically in the shop, and
 * the server reconciles it on both the branch ledger and the production pool.
 * `demandStockMoved` comes from the ledger rather than the order's status, which
 * cannot answer the question — see migration 77.
 */
function DemandItemsDialog({ ticket, reference: snapshot, onClose, onDone }: {
  ticket: SupportTicket;
  reference: SupportReference;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  // Same reasoning as the sale editor: the snapshot is from when the query was
  // raised, and the demand may have been re-reviewed since. Seed from it, then
  // reseed once the live reference lands.
  const { reference: live, loading } = useLiveReference(ticket);
  const reference = live ?? snapshot;
  const [rows, setRows] = useState<DemandRow[]>(
    () => (snapshot.demandItems ?? []).map((it, i) => ({ ...it, key: `orig-${i}` })),
  );
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiCall<{ products: Product[] }>('/api/products?isActive=true', {}, token)
      .then((r) => setProducts(r.products ?? []))
      .catch(() => toast.error('Could not load products'));
  }, [token]);

  const [seededFrom, setSeededFrom] = useState<SupportReference | null>(snapshot);
  if (live && live !== seededFrom) {
    setSeededFrom(live);
    if (live.demandItems) setRows(live.demandItems.map((it, i) => ({ ...it, key: `live-${i}` })));
  }

  const stockMoved = reference.demandStockMoved === true;
  const original = useMemo(
    () => new Map((reference.demandItems ?? []).map((i) => [i.productId, i.approvedQty])),
    [reference.demandItems],
  );

  // What the branch ledger will actually move, previewed exactly as the server
  // computes it: new approved − old approved, per product, zero-deltas dropped.
  const deltas = useMemo(() => {
    const out: { productName: string; delta: number }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.productId) continue;
      seen.add(r.productId);
      const d = r.approvedQty - (original.get(r.productId) ?? 0);
      if (d !== 0) out.push({ productName: r.productName, delta: d });
    }
    for (const [pid, approved] of original) {
      if (!seen.has(pid) && approved !== 0) {
        out.push({ productName: (reference.demandItems ?? []).find((i) => i.productId === pid)?.productName ?? 'Removed line', delta: -approved });
      }
    }
    return out;
  }, [rows, original, reference.demandItems]);

  function patchRow(key: string, patch: Partial<DemandRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function pickProduct(key: string, p: Product | null) {
    if (!p) return;
    patchRow(key, { productId: p.id, productName: p.name });
  }
  function addRow() {
    const key = `new-${seq}`;
    setSeq((n) => n + 1);
    setRows((rs) => [...rs, { key, productId: '', productName: '', qty: 0, approvedQty: 0 }]);
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  const duplicated = useMemo(() => {
    const ids = rows.map((r) => r.productId).filter(Boolean);
    return new Set(ids).size !== ids.length;
  }, [rows]);
  const rowValid = (r: DemandRow) => Boolean(r.productId) && r.qty >= 0 && r.approvedQty >= 0;
  const valid = rows.length > 0 && rows.every(rowValid) && !duplicated;

  async function submit() {
    if (!valid) {
      toast.error(duplicated ? 'The same product is on two lines — combine them' : 'Every line needs a product and quantities of 0 or more');
      return;
    }
    setBusy(true);
    try {
      const items = rows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        qty: r.qty,
        approvedQty: r.approvedQty,
      }));
      await apiCall(`/api/support/${ticket.id}/demand-items`, { method: 'PATCH', body: JSON.stringify({ items, reason, note }) }, token);
      toast.success(stockMoved && deltas.length ? 'Demand updated, stock reconciled & query resolved' : 'Demand updated & query resolved');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the demand');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit demand — {ticket.referenceId}</DialogTitle>
          <DialogDescription>
            <span className="font-medium">Requested</span> is what the branch asked for.{' '}
            <span className="font-medium">Approved</span> is what Production granted — that is the
            figure that moves stock. Add or remove products, or change either quantity.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-xs text-muted-foreground">Reading the demand’s live figures…</p>}

        {stockMoved ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This demand has already been delivered. Changing <span className="font-medium">Approved</span>{' '}
            moves real stock — the difference is applied to the branch and taken back out of the
            production pool.
          </p>
        ) : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            This demand has not delivered yet, so no stock moves. Whatever Approved says here is what
            will be transferred when the branch verifies receipt.
          </p>
        )}

        <div className="space-y-2">
          <div className="hidden gap-2 px-1 text-xs uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_6rem_6rem_2rem]">
            <span>Product</span><span className="text-center">Requested</span><span className="text-center">Approved</span><span />
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_6rem_6rem_2rem] sm:items-end sm:border-0 sm:p-0">
              <LineField label="Product">
                <Combobox
                  items={products}
                  filter={productMatchesQuery}
                  value={products.find((p) => p.id === r.productId) ?? null}
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
                          <span className="font-medium">{p.sku} · {p.name}</span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </LineField>
              <LineField label="Requested">
                <Input
                  type="number" min={0} inputMode="numeric" className="text-center tabular-nums"
                  value={r.qty}
                  onChange={(e) => patchRow(r.key, { qty: Number(e.target.value) })}
                />
              </LineField>
              <LineField label="Approved">
                <Input
                  type="number" min={0} inputMode="numeric" className="text-center tabular-nums"
                  value={r.approvedQty}
                  onChange={(e) => patchRow(r.key, { approvedQty: Number(e.target.value) })}
                />
              </LineField>
              <Button variant="ghost" size="icon" title="Remove this product" onClick={() => removeRow(r.key)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4" /> Add product</Button>
          {duplicated && <p className="text-xs text-destructive">The same product is on more than one line — combine them.</p>}
        </div>

        {stockMoved && deltas.length > 0 && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Stock that will move</p>
            {deltas.map((d) => (
              <div key={d.productName} className="flex justify-between">
                <span className="text-muted-foreground">{d.productName}</span>
                <span className={cn('tabular-nums', d.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  {d.delta > 0 ? `+${d.delta}` : d.delta}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Reason (kept on the demand)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this was corrected" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Resolution note (sent to the raiser)</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was done" />
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Separated from the save actions on purpose: this is the one control
              here that cannot be undone, and grouping it beside "Save & resolve"
              is how it gets clicked by muscle memory. */}
          <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash2 className="h-4 w-4" /> Delete demand
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save & resolve'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {confirmDelete && (
        <DeleteDemandDialog
          ticket={ticket}
          stockMoved={stockMoved}
          onClose={() => setConfirmDelete(false)}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

/**
 * Destroying a demand outright — the escalation from the line editor, for one
 * that was verified when it should never have been. No set of corrected lines
 * says "this delivery did not happen": the editor refuses an empty line list,
 * and a line left at zero still leaves a document asserting a delivery.
 *
 * This is the only irreversible action in the Support Center, so it asks for the
 * demand number to be typed out. The Support Center is a queue of rows that all
 * look alike, and the cost of deleting the wrong one is a demand that cannot be
 * brought back — the ledger keeps its entries and audit_logs keeps a snapshot,
 * but the order itself is gone. The server re-checks the typed number against
 * the ticket's own reference rather than trusting this comparison.
 */
function DeleteDemandDialog({ ticket, stockMoved, onClose, onDone }: {
  ticket: SupportTicket;
  stockMoved: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const demandNumber = ticket.referenceId ?? '';
  const numberMatches = confirm.trim().toUpperCase() === demandNumber.trim().toUpperCase();
  // Mirrors DeleteDemandSchema's `.trim().min(5)` so the button disables for the
  // same input the server would reject.
  const reasonValid = reason.trim().length >= 5;

  async function submit() {
    setBusy(true);
    try {
      const res = await apiCall<{ stockMoved: boolean; branchReversals: { productName: string; delta: number }[] }>(
        `/api/support/${ticket.id}/demand`,
        { method: 'DELETE', body: JSON.stringify({ reason, confirmDemandNumber: confirm, note }) },
        token,
      );
      toast.success(
        res.stockMoved
          ? `${demandNumber} deleted — stock reversed on ${res.branchReversals.length} product${res.branchReversals.length === 1 ? '' : 's'}`
          : `${demandNumber} deleted`,
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the demand');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete demand — {demandNumber}</DialogTitle>
          <DialogDescription>
            This permanently removes the demand and every line on it. It cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {stockMoved ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            This demand has already been delivered. Deleting it gives the stock back to the
            production pool and takes it off the branch — the branch&rsquo;s balance will drop by
            everything this demand credited.
          </p>
        ) : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            This demand never delivered, so no stock moves. Only the demand itself is removed.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          The stock ledger keeps both the original movements and the reversal, and a full copy of
          the demand is written to the audit log — so the figures stay explainable after it is gone.
        </p>

        <div className="space-y-1">
          <Label className="text-xs">Reason (required, kept in the audit log)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this demand is being deleted"
            aria-invalid={reason.length > 0 && !reasonValid}
          />
          {reason.length > 0 && !reasonValid && (
            <p className="text-xs text-destructive">Give at least a few words.</p>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">
            Type <span className="font-mono font-semibold text-foreground">{demandNumber}</span> to confirm
          </Label>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={demandNumber}
            autoComplete="off"
            aria-invalid={confirm.length > 0 && !numberMatches}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Resolution note (sent to the raiser)</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was done" />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !numberMatches || !reasonValid}>
            <Trash2 className="h-4 w-4" /> {busy ? 'Deleting…' : 'Delete demand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Terminal state for a reference that carries nothing correctable — the
 * production stock pool, a Production counter sale, or a 'system' ticket.
 * Answering it is a resolution note, which lives in View.
 *
 * A rejected/cancelled demand no longer lands here: its lines still cannot be
 * corrected, but it can now be deleted, so it routes to DeleteDemandDialog.
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
  /**
   * Which end of the residual the admin is typing. Balance and Adjustment are ONE
   * degree of freedom — adjustment is the residual in
   * opening + new − sold − returned + adjustment = balance — so exactly one of
   * them can be entered and the other is derived. The server refuses both
   * (migration 78); this is what stops the UI ever sending them.
   *
   * 'balance' is the default and is the old behaviour: reconcile to a counted
   * shelf. 'adjustment' is for when the correction itself is the intent —
   * including setting it to 0, which clears the day's correction.
   */
  const [residualMode, setResidualMode] = useState<'balance' | 'adjustment'>('balance');
  const [adjustmentTouched, setAdjustmentTouched] = useState(false);
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
          opening: String(f.opening),
          newQty: String(f.newQty),
          sold: String(f.sold),
          returned: String(f.returned),
          adjustment: String(f.adjustment),
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
    return num(targets['opening']) + num(targets['newQty']) - num(targets['sold']) - num(targets['returned']) + figures.adjustment;
  }, [figures, targets]);

  // The balance the other three figures imply with the adjustment REMOVED — the
  // base that a typed Adjustment is added to.
  const baseWithoutAdjustment = useMemo(() => {
    if (!figures) return 0;
    return num(targets['opening']) + num(targets['newQty']) - num(targets['sold']) - num(targets['returned']);
  }, [figures, targets]);

  const inAdjustmentMode = residualMode === 'adjustment';

  // The extra adjustment the typed Balance would book on top of the other edits.
  // In adjustment mode the admin states the adjustment outright instead.
  const extraAdjustment = inAdjustmentMode
    ? num(targets['adjustment']) - (figures?.adjustment ?? 0)
    : balanceTouched ? num(targets['balance']) - implied : 0;

  const finalBalance = inAdjustmentMode
    ? baseWithoutAdjustment + num(targets['adjustment'])
    : balanceTouched ? num(targets['balance']) : implied;

  const finalAdjustment = inAdjustmentMode
    ? num(targets['adjustment'])
    : (figures?.adjustment ?? 0) + extraAdjustment;

  function setFigure(key: string, value: string) {
    setTargets((t) => ({ ...t, [key]: value }));
    if (key === 'balance') setBalanceTouched(true);
    if (key === 'adjustment') setAdjustmentTouched(true);
  }

  // Keep Balance showing the implied result while the admin has not overridden it.
  const shownBalance = inAdjustmentMode
    ? String(finalBalance)
    : balanceTouched ? (targets['balance'] ?? '') : String(implied);
  // Mirror image: in balance mode the Adjustment box shows what will be booked.
  const shownAdjustment = inAdjustmentMode
    ? (adjustmentTouched ? (targets['adjustment'] ?? '') : String(figures?.adjustment ?? 0))
    : String(finalAdjustment);

  const invalid =
    ['opening', 'newQty', 'sold', 'returned'].some((k) => {
      const v = num(targets[k]);
      return targets[k] === '' || !Number.isFinite(v) || v < 0;
    }) ||
    // A cleared box is not "zero" — it is no figure at all, and would otherwise
    // submit as a count of 0. (Adjustment 0 is meaningful, but only when TYPED.)
    (!inAdjustmentMode && balanceTouched && targets['balance'] === '') ||
    (inAdjustmentMode && (targets['adjustment'] === '' || !Number.isFinite(num(targets['adjustment'])))) ||
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
    for (const k of ['opening', 'newQty', 'sold', 'returned'] as const) {
      if (num(targets[k]) !== figures[k]) out[k] = num(targets[k]);
    }
    // Exactly one of the pair, never both — the server refuses both, and they are
    // two names for the same free variable.
    if (inAdjustmentMode) {
      if (adjustmentTouched && num(targets['adjustment']) !== figures.adjustment) {
        out['adjustment'] = num(targets['adjustment']);
      }
    } else if (balanceTouched && num(targets['balance']) !== implied) {
      out['balance'] = num(targets['balance']);
    }
    return out;
  }, [figures, targets, balanceTouched, adjustmentTouched, inAdjustmentMode, implied]);

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
            {/* Opening is editable, but it is not a figure about TODAY: it is
                yesterday's closing. A movement dated today cannot shift it —
                balance and the day's net move together and the difference does
                not budge — so the server dates the correction to the previous
                business day. Hence the warning, and hence its own block rather
                than sitting with the day's figures below. */}
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label>Opening Stock</Label>
                  <span className="text-xs text-muted-foreground">
                    now {figures.opening} · carried from yesterday
                  </span>
                </div>
                <Input
                  type="number" min="0" step="0.001" inputMode="decimal"
                  className="text-right"
                  value={targets['opening'] ?? ''}
                  onChange={(e) => setFigure('opening', e.target.value)}
                />
                {figures && num(targets['opening']) !== figures.opening && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    This corrects <strong>yesterday’s closing</strong>, so the change is
                    recorded on the previous business day. Today’s New / Sold / Returned
                    are untouched; the balance moves by{' '}
                    {num(targets['opening']) - figures.opening > 0 ? '+' : ''}
                    {num(targets['opening']) - figures.opening}.
                  </p>
                )}
              </div>
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

            {/* Balance and Adjustment are one degree of freedom: type either and
                the other follows. The toggle picks which one is the input, so the
                pair can never both be sent. */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Set the shelf count, or set the correction
                </Label>
                <div className="flex gap-1">
                  <Button
                    type="button" size="sm"
                    variant={inAdjustmentMode ? 'ghost' : 'secondary'}
                    onClick={() => setResidualMode('balance')}
                  >
                    Balance
                  </Button>
                  <Button
                    type="button" size="sm"
                    variant={inAdjustmentMode ? 'secondary' : 'ghost'}
                    onClick={() => setResidualMode('adjustment')}
                  >
                    Adjustment
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label>Balance</Label>
                  <span className="text-xs text-muted-foreground">
                    now {figures.balance} ·{' '}
                    {inAdjustmentMode ? 'follows the adjustment' : balanceTouched ? 'set by hand' : 'follows the figures above'}
                  </span>
                </div>
                <Input
                  type="number" min="0" step="0.001" inputMode="decimal"
                  disabled={inAdjustmentMode}
                  className={cn('text-right', finalBalance < 0 && 'border-destructive')}
                  value={shownBalance}
                  onChange={(e) => setFigure('balance', e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label>Adjustment</Label>
                  <span className="text-xs text-muted-foreground">
                    now {figures.adjustment > 0 ? `+${figures.adjustment}` : figures.adjustment} ·{' '}
                    {inAdjustmentMode ? 'signed — may be negative' : 'follows the balance'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    // No min: an adjustment is signed. Clearing it is `0`.
                    type="number" step="0.001" inputMode="decimal"
                    disabled={!inAdjustmentMode}
                    className="text-right"
                    value={shownAdjustment}
                    onChange={(e) => setFigure('adjustment', e.target.value)}
                  />
                  <Button
                    type="button" variant="outline"
                    title="Clear today's correction — sets Adjustment to 0 and gives the balance back"
                    disabled={figures.adjustment === 0 && num(targets['adjustment']) === 0}
                    onClick={() => { setResidualMode('adjustment'); setFigure('adjustment', '0'); }}
                  >
                    Clear
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only today’s corrections. The column clears tomorrow on its own — the
                  effect stays inside the balance that becomes tomorrow’s Opening.
                </p>
              </div>

              {extraAdjustment !== 0 && (
                <p className="text-xs text-muted-foreground">
                  {inAdjustmentMode
                    ? `Adjustment ${figures.adjustment} → ${finalAdjustment}, so Balance ${figures.balance} → ${finalBalance}.`
                    : `Booked as an adjustment of ${extraAdjustment > 0 ? `+${extraAdjustment}` : extraAdjustment}.`}
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

/** What /figures reports back when it corrected the production pool. */
interface ProductionCorrectionResult {
  applied: boolean;
  productName: string;
  before: ProductionStockFigures;
  after: ProductionStockFigures;
  movements: { type: string; delta: number }[];
}

const PRODUCTION_FIELDS = [
  { key: 'preparedToday', label: 'Prepared Today', hint: 'units made today' },
  { key: 'approvedQty', label: 'Approved Qty', hint: 'units sent out on demands' },
  { key: 'soldToday', label: 'Sold', hint: 'units sold at the counter' },
  { key: 'returned', label: 'Returned', hint: 'units taken back from branches' },
] as const;

/**
 * Production-pool correction — the pool's counterpart of StockFiguresDialog.
 *
 * Same shape and same rules: the LIVE row is re-read (the ticket's snapshot is from
 * when the query was raised), each figure is set to what it should read, and the
 * server sizes one compensating movement per figure.
 *
 * Two differences from the branch editor, both following the pool's own model:
 *   · There is no Opening. The pool carries one running balance and no per-day
 *     open/close, so the four movement figures plus Pool Balance are the whole
 *     row. Total Stock and Today's Balance are shown above them as derived
 *     read-outs, matching what the Production Stock page reports for the day.
 *   · A negative Balance is ALLOWED — the pool is flagged when negative, never
 *     blocked, and a product already negative has to stay correctable. It is warned
 *     about rather than refused.
 *
 * Total Stock is shown but not editable: it is balance + approved + sold, so it
 * follows the figures above it and has no movement of its own to correct.
 */
function ProductionStockFiguresDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const { reference, loading } = useLiveReference(ticket);
  const figures = reference?.productionFigures ?? null;
  // Only what the admin actually typed. Everything else is DERIVED from the live
  // figures below, so the inputs need no seeding effect and cannot show a stale
  // value if the lookup resolves late.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const productName = reference?.fields.find((f) => f.label === 'Product')?.value ?? ticket.referenceId;

  const num = (v: string | undefined) => Number(v ?? 0);
  const t: Record<string, string> = {
    ...(figures
      ? {
          preparedToday: String(figures.preparedToday),
          approvedQty: String(figures.approvedQty),
          soldToday: String(figures.soldToday),
          returned: String(figures.returned),
        }
      : {}),
    ...edited,
  };
  // Until the admin edits Balance themselves, it tracks the four figures above it.
  const balanceTouched = edited['balance'] !== undefined;

  /**
   * Balance implied by the figures as typed. Prepared and returned add to the pool;
   * approved and sold take from it — the same arithmetic the server applies, so the
   * preview and the write agree.
   */
  const implied = figures
    ? figures.balance +
      (num(t['preparedToday']) - figures.preparedToday) -
      (num(t['approvedQty']) - figures.approvedQty) +
      (num(t['returned']) - figures.returned) -
      (num(t['soldToday']) - figures.soldToday)
    : 0;

  const extraAdjustment = balanceTouched ? num(t['balance']) - implied : 0;
  const finalBalance = balanceTouched ? num(t['balance']) : implied;

  function setFigure(key: string, value: string) {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }

  const shownBalance = balanceTouched ? (t['balance'] ?? '') : String(implied);

  const invalid =
    !figures ||
    PRODUCTION_FIELDS.some((f) => {
      const v = num(t[f.key]);
      return t[f.key] === '' || !Number.isFinite(v) || v < 0;
    }) ||
    // A cleared Balance is not "zero" — it is no figure at all.
    (balanceTouched && (t['balance'] === '' || !Number.isFinite(num(t['balance']))));

  /**
   * Only the figures the admin actually moved. An untouched figure is omitted so a
   * movement recorded while the dialog was open is not reverted by a stale absolute
   * target — the same reason the branch editor sends a partial set.
   */
  const edits: Record<string, number> = {};
  if (figures) {
    for (const f of PRODUCTION_FIELDS) {
      if (num(t[f.key]) !== figures[f.key]) edits[f.key] = num(t[f.key]);
    }
    if (balanceTouched && num(t['balance']) !== implied) edits['balance'] = num(t['balance']);
  }

  const changed = Object.keys(edits).length > 0;

  async function submit() {
    if (invalid) { toast.error('Prepared, Approved, Sold and Returned must each be 0 or more'); return; }
    if (!changed) { toast.error('Change at least one figure'); return; }
    setBusy(true);
    try {
      const res = await apiCall<{ applied: boolean; productionStock: ProductionCorrectionResult | null }>(
        `/api/support/${ticket.id}/figures`,
        { method: 'PATCH', body: JSON.stringify({ edits, note }) },
        token,
      );
      toast.success(
        res.productionStock?.applied
          ? `Production stock corrected — balance ${res.productionStock.before.balance} → ${res.productionStock.after.balance}`
          : 'Production stock already matched — query resolved',
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to correct the production stock');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Correct production stock — {ticket.referenceId}</DialogTitle>
          <DialogDescription>
            {productName} · central production pool — set each figure to what it should
            read. The pool is adjusted to match and the query is resolved.
          </DialogDescription>
        </DialogHeader>

        {loading && !figures ? (
          <p className="text-sm text-muted-foreground">Loading current pool figures…</p>
        ) : !figures ? (
          <p className="text-sm text-muted-foreground">Current pool figures are unavailable.</p>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
              {/* No Opening row, unlike the branch dialog. The Production Stock
                  page reads the pool as the day it had — nothing carried over —
                  so a query raised from that page has to resolve against the same
                  figures, and an opening balance here would not be one of them.
                  Both rows are derived, so neither is editable. */}
              <FigureRow label="Total Stock" value={String(figures.totalStock)} hint="prepared + returned today" />
              <FigureRow
                label="Today's Balance"
                value={String(figures.dayBalance)}
                hint="what the Production Stock page shows"
              />
              {figures.adjustment !== 0 && (
                <FigureRow
                  label="Adjustment so far"
                  value={figures.adjustment > 0 ? `+${figures.adjustment}` : String(figures.adjustment)}
                  hint="earlier corrections today"
                />
              )}
            </div>

            {PRODUCTION_FIELDS.map((f) => (
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
                  value={t[f.key] ?? ''}
                  onChange={(e) => setFigure(f.key, e.target.value)}
                />
              </div>
            ))}

            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                {/* The RUNNING pool total, not the day figure above it. This is
                    the one the pool actually stores and the one a correction
                    writes to, so the two can legitimately differ. */}
                <Label>Pool Balance</Label>
                <span className="text-xs text-muted-foreground">
                  now {figures.balance} · {balanceTouched ? 'set by hand' : 'follows the figures above'}
                </span>
              </div>
              <Input
                type="number" step="0.001" inputMode="decimal"
                className={cn('text-right', finalBalance < 0 && 'border-amber-500')}
                value={shownBalance}
                onChange={(e) => setFigure('balance', e.target.value)}
              />
              {extraAdjustment !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Booked as an adjustment of {extraAdjustment > 0 ? `+${extraAdjustment}` : extraAdjustment}.
                </p>
              )}
              {finalBalance < 0 && (
                <p className="text-xs text-amber-600">
                  This leaves the pool negative. Allowed — the Production Stock page flags
                  it in red — but check it is really what the shelf says.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Correcting <strong>Sold</strong> moves pool stock only — it does not change
              the counter sale, its total or its tender. Production counter sales are not
              editable from here, so answer the sale query in words and correct its stock
              effect above.
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
