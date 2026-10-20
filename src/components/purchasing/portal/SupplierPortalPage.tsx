'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2Off, Loader2, MessageCircle, PencilLine, RotateCcw, WifiOff } from 'lucide-react';
import type { SupplierPortalView } from '@mb/shared';
import { Button } from '@/components/ui/button';
import {
  forgetLinkToken,
  looksLikeToken,
  supplierPortalApi,
  SupplierPortalError,
  takeLinkToken,
  type BillSubmitResult,
  type QuotationSubmitResult,
} from '@/lib/supplierPortal';
import { Notice, PortalShell } from './portalUi';
import { BillCard, DemandSummary, ProductionNote, QuotationCard, readOnlyMessage } from './PortalViews';
import { QuotationForm } from './QuotationForm';
import { BillForm } from './BillForm';
import { rs } from './portalFormat';

/**
 * /supplier-portal/ — what an outside supplier sees when they tap the link in
 * Mountain Bakes' WhatsApp message. No sign-in: the link's token (read from the
 * URL fragment by takeLinkToken, then removed from the address bar) authorizes
 * this one demand, and the API re-checks it on every request.
 *
 * What is shown is exactly SupplierPortalView — the demand, the supplier's own
 * quotations and bill, Production's note when it asked for something — and
 * nothing else: no balance, no other demand, no staff name.
 *
 * This page keeps its data in component state, not in React Query, on purpose:
 * the app's offline snapshot (OfflineCache) writes the query cache to disk for
 * a signed-in staff user, and a supplier's demand must not land in a staff
 * member's on-device cache because they opened the link on their phone.
 */

type Phase =
  | { kind: 'starting' }
  | { kind: 'no-token' }
  | { kind: 'loading' }
  /** `token` is carried here (not read from the ref) because render may not read a ref. */
  | { kind: 'ready'; view: SupplierPortalView; token: string }
  | { kind: 'dead'; message: string }
  | { kind: 'error'; message: string; offline: boolean };

type Sent =
  | { type: 'quotation'; version: number; total: number; replayed: boolean }
  | { type: 'bill'; supplierBillNo: string; grandTotal: number; differs: boolean; replayed: boolean };

const INVALID_LINK = 'This link is not valid. Use the link in the latest WhatsApp message from Mountain Bakes.';

export function SupplierPortalPage() {
  const tokenRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [sent, setSent] = useState<Sent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [reloading, setReloading] = useState(false);
  const loadSeq = useRef(0);

  const linkDead = useCallback((err: SupplierPortalError) => {
    forgetLinkToken();
    tokenRef.current = null;
    setPhase({ kind: 'dead', message: err.message });
  }, []);

  /** Fetch the demand. `quiet` keeps the current screen up while it reloads. */
  const load = useCallback(
    async (quiet = false) => {
      const token = tokenRef.current;
      if (!token) return;
      const seq = ++loadSeq.current;
      if (quiet) setReloading(true);
      else setPhase({ kind: 'loading' });
      try {
        const view = await supplierPortalApi.demand(token);
        if (seq !== loadSeq.current) return;
        setPhase({ kind: 'ready', view, token });
      } catch (err) {
        if (seq !== loadSeq.current) return;
        const e = err instanceof SupplierPortalError ? err : new SupplierPortalError('Something went wrong.', 'server', 0);
        if (e.kind === 'link') linkDead(e);
        else setPhase({ kind: 'error', message: e.message, offline: e.kind === 'network' });
      } finally {
        if (seq === loadSeq.current) setReloading(false);
      }
    },
    [linkDead],
  );

  // Take the token from the link once, on arrival — and again if another link
  // is tapped while this tab is open (same page, so only the fragment changes).
  useEffect(() => {
    const arrive = () => {
      const token = takeLinkToken();
      if (!token) {
        if (!tokenRef.current) setPhase({ kind: 'no-token' });
        return;
      }
      if (token === tokenRef.current) return;
      setSent(null);
      setNotice(null);
      setRevising(false);
      if (!looksLikeToken(token)) {
        forgetLinkToken();
        tokenRef.current = null;
        setPhase({ kind: 'dead', message: INVALID_LINK });
        return;
      }
      tokenRef.current = token;
      void load();
    };
    arrive();
    window.addEventListener('hashchange', arrive);
    return () => window.removeEventListener('hashchange', arrive);
  }, [load]);

  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  function quotationSent(r: QuotationSubmitResult) {
    setSent({ type: 'quotation', version: r.version, total: r.total, replayed: r.replayed });
    setNotice(null);
    setRevising(false);
    setPhase((p) => (p.kind === 'ready' ? { ...p, view: r.demand } : p));
    top();
  }

  function billSent(r: BillSubmitResult) {
    setSent({ type: 'bill', supplierBillNo: r.supplierBillNo, grandTotal: r.grandTotal, differs: r.differsFromQuotation, replayed: r.replayed });
    setNotice(null);
    setRevising(false);
    setPhase((p) => (p.kind === 'ready' ? { ...p, view: r.demand } : p));
    top();
  }

  function stale(message: string) {
    setNotice(`${message} This page now shows the latest details.`);
    setRevising(false);
    setSent(null);
    void load(true);
    top();
  }

  if (phase.kind === 'starting' || phase.kind === 'loading') {
    return (
      <PortalShell>
        <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-4 py-16 text-center" role="status">
          <Loader2 className="size-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Opening your purchase request…</p>
        </div>
      </PortalShell>
    );
  }

  if (phase.kind === 'no-token') {
    return (
      <PortalShell>
        <StateCard
          icon={<MessageCircle className="size-8 text-primary" />}
          title="Open the link from your WhatsApp message"
          body="This page shows a Mountain Bakes purchase request. To see yours, tap the link in the WhatsApp message Mountain Bakes sent you."
        />
      </PortalShell>
    );
  }

  if (phase.kind === 'dead') {
    return (
      <PortalShell>
        <StateCard
          icon={<Link2Off className="size-8 text-destructive" />}
          title="This link can't be used"
          body={phase.message}
          footer="If you still need to send a quotation or bill, ask Mountain Bakes on WhatsApp to send you a new link."
        />
      </PortalShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <PortalShell>
        <StateCard
          icon={phase.offline ? <WifiOff className="size-8 text-muted-foreground" /> : <RotateCcw className="size-8 text-muted-foreground" />}
          title={phase.offline ? 'No connection' : 'Could not open the request'}
          body={phase.message}
          action={
            <Button className="h-12 w-full text-base sm:w-auto" onClick={() => void load()}>
              <RotateCcw className="size-4" /> Try again
            </Button>
          }
        />
      </PortalShell>
    );
  }

  const { view, token } = phase;
  const billing = view.canBill && !!view.approvedQuotation;
  // While the supplier has a quotation waiting with Mountain Bakes, show it and
  // offer a revision instead of putting an editable form in their way.
  const quotationWaiting = view.status === 'quotation_received' && !!view.latestQuotation;
  const formKey = `${view.status}:${view.latestQuotation?.id ?? 'none'}:${view.latestBill?.id ?? 'none'}`;

  let main: React.ReactNode;
  if (revising && view.canQuote) {
    main = (
      <QuotationForm
        key={`revise:${formKey}`}
        view={view}
        token={token}
        withdrawsApproval={view.status === 'awaiting_supplier_bill'}
        onSubmitted={quotationSent}
        onCancel={() => setRevising(false)}
        onLinkError={linkDead}
        onStale={stale}
      />
    );
  } else if (billing) {
    main = (
      <>
        <BillForm key={`bill:${formKey}`} view={view} token={token} onSubmitted={billSent} onLinkError={linkDead} onStale={stale} />
        {view.approvedQuotation && (
          <QuotationCard
            quotation={view.approvedQuotation}
            title={`Approved quotation · version ${view.approvedQuotation.version}`}
            actions={
              view.canQuote ? (
                <Button variant="outline" className="h-11 w-full" onClick={() => { setRevising(true); setSent(null); top(); }}>
                  <PencilLine className="size-4" /> Change the quotation instead
                </Button>
              ) : undefined
            }
          />
        )}
        {view.latestBill && view.latestBill.status === 'rejected' && <BillCard bill={view.latestBill} />}
      </>
    );
  } else if (view.canQuote && !quotationWaiting) {
    main = (
      <QuotationForm key={`quote:${formKey}`} view={view} token={token} onSubmitted={quotationSent} onLinkError={linkDead} onStale={stale} />
    );
  } else if (view.canQuote && view.latestQuotation) {
    main = (
      <>
        <Notice tone="info" title="Your quotation is with Mountain Bakes">
          They will reply on WhatsApp. You can still send a corrected version until they decide.
        </Notice>
        <QuotationCard
          quotation={view.latestQuotation}
          actions={
            <Button variant="outline" className="h-11 w-full" onClick={() => { setRevising(true); setSent(null); top(); }}>
              <PencilLine className="size-4" /> Revise quotation
            </Button>
          }
        />
      </>
    );
  } else {
    const msg = readOnlyMessage(view);
    main = (
      <>
        <Notice tone="info" title={msg.title}>
          {msg.body}
        </Notice>
        {view.latestBill && <BillCard bill={view.latestBill} />}
        {(view.approvedQuotation ?? view.latestQuotation) && (
          <QuotationCard
            quotation={(view.approvedQuotation ?? view.latestQuotation)!}
            title={view.approvedQuotation ? `Approved quotation · version ${view.approvedQuotation.version}` : undefined}
          />
        )}
      </>
    );
  }

  return (
    <PortalShell>
      {sent && <SentNotice sent={sent} />}
      {notice && <Notice tone="warning">{notice}</Notice>}
      {reloading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" /> Refreshing…
        </p>
      )}
      <ProductionNote view={view} />
      <DemandSummary view={view} />
      {main}
    </PortalShell>
  );
}

function SentNotice({ sent }: { sent: Sent }) {
  if (sent.type === 'quotation') {
    return (
      <Notice tone="success" title={`Quotation version ${sent.version} sent to Mountain Bakes`}>
        {sent.replayed ? 'Mountain Bakes had already received it — it was not sent twice. ' : ''}
        Total recorded: <span className="font-semibold">{rs(sent.total)}</span>. They will reply on WhatsApp.
      </Notice>
    );
  }
  return (
    <Notice tone="success" title={`Bill ${sent.supplierBillNo} sent to Mountain Bakes`}>
      {sent.replayed ? 'Mountain Bakes had already received it — it was not sent twice. ' : ''}
      Bill total recorded: <span className="font-semibold">{rs(sent.grandTotal)}</span>.
      {sent.differs && ' It differs from the approved quotation, so Mountain Bakes will check the difference.'}
    </Notice>
  );
}

function StateCard({
  icon,
  title,
  body,
  footer,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  footer?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card px-5 py-10 text-center shadow-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">{icon}</div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
        {footer && <p className="max-w-sm text-xs text-muted-foreground">{footer}</p>}
        {action && <div className="mt-2 w-full sm:w-auto">{action}</div>}
      </div>
    </div>
  );
}
