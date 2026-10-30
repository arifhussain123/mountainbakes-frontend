'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AI_CAPTURE_MAX_PHOTOS, financeCanReview, type FinanceTransaction } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { copyReceiptPhoto, useAnalyzeReceipts, useFinanceMutation, useLedgerHeads } from '@/lib/finance';
import {
  compressImage,
  DOCUMENT_PROFILE,
  discardAttachment,
  uploadAttachmentWithProgress,
  type CompressedImage,
  type ImageProfile,
} from '@/lib/attachments';
import { ApiError } from '@/utils/api';
import { ROUTES } from '@/utils/routes';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FinancePageHeader, Money, useFinanceAbilities } from '@/components/finance/finance-ui';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Loader2, Save, Sparkles } from 'lucide-react';
import { ReceiptUploader, type ReceiptPhoto } from './ReceiptUploader';
import { AiExpenseCard, type CardAction } from './AiExpenseCard';
import {
  canCombine,
  combineDrafts,
  createBody,
  draftFromProposal,
  splitDraft,
  summarize,
  type AiDraft,
} from './aiCaptureDraft';

/**
 * Finance → AI Expense Capture (owner's order, 2026-10-30).
 *
 * Photograph or upload receipts; Generate sends them to the server, which has
 * Google Gemini read them and proposes one expense per bill. Each proposal is
 * a card to check and edit; Approve marks it ready and Save Approved saves the
 * approved cards one at a time through the ordinary Income & Expense create —
 * as drafts, exactly like the New Entry form, so each still goes through
 * Accounts and Finance Admin before it reaches the ledger.
 *
 * Every card has one Idempotency-Key for its life, so a save retried after a
 * dropped connection returns the entry already made instead of a second one.
 * A card shows Saved only once the server has answered with the entry.
 */

/**
 * Receipts are for reading, by a person and now by the AI: the stored size
 * stays the documents' one, with more room in the byte budget than a plain
 * receipt so small print survives.
 */
const RECEIPT_PROFILE: ImageProfile = { ...DOCUMENT_PROFILE, targetBytes: 700 * 1024 };

const EXPENSE_BRANCH_NAMES = ['production', 'other'];

const STEPS = ['Uploading receipts', 'Reading receipts with AI', 'Ready for review'] as const;

function newLocalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function AiExpenseCapturePage() {
  const { token, user } = useAuth();
  const abilities = useFinanceAbilities();
  const headsQ = useLedgerHeads();
  const branchesQ = useBranches(token ?? '');
  const analyze = useAnalyzeReceipts();
  const save = useFinanceMutation<{ entry: FinanceTransaction }>();

  const [photos, setPhotos] = useState<ReceiptPhoto[]>([]);
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ urls: string[]; index: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'split' | 'combine'; key: string; otherKey?: string } | null>(null);
  /** Compressed images by local id — kept for a retried upload. */
  const images = useRef(new Map<string, CompressedImage>());
  /** Each photo's object URL by local id, for callbacks that outlive a render. */
  const previewUrls = useRef(new Map<string, string>());
  /** Preview URL by attachment id, including a split's copies. */
  const [thumbs, setThumbs] = useState(new Map<string, string>());

  const heads = (headsQ.data ?? []).filter((h) => h.type === 'expense' && h.isActive);
  const branches = (branchesQ.data ?? []).filter((b) => EXPENSE_BRANCH_NAMES.includes(b.name.trim().toLowerCase()));
  const summary = summarize(photos.length, drafts);
  const uploading = photos.some((p) => p.status === 'processing' || p.status === 'uploading');
  const busy = analyze.isPending || saving;
  const pendingPhotos = photos.filter((p) => p.status === 'ready' && !p.analyzed && !p.saved && p.attachmentId);
  const approved = drafts.filter((d) => d.status === 'approved');
  const unsaved = drafts.some((d) => d.status !== 'saved');

  // Leaving with cards still unsaved loses them; ask first.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Object URLs are freed when the page goes.
  const urls = useRef<string[]>([]);
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const patchPhoto = (localId: string, patch: Partial<ReceiptPhoto>) =>
    setPhotos((list) => list.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  const patchDraft = (key: string, patch: Partial<AiDraft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function upload(localId: string, image: CompressedImage) {
    if (!token) return;
    patchPhoto(localId, { status: 'uploading', progress: 0, error: null });
    try {
      const attachment = await uploadAttachmentWithProgress('finance_transaction', image, token, {
        onProgress: (f) => patchPhoto(localId, { progress: f }),
      });
      patchPhoto(localId, { status: 'ready', attachmentId: attachment.id, progress: 1 });
      const url = previewUrls.current.get(localId);
      if (url) setThumbs((m) => new Map(m).set(attachment.id, url));
    } catch (err) {
      patchPhoto(localId, { status: 'error', error: errorText(err, 'Upload failed') });
    }
  }

  async function prepare(localId: string, file: File) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      patchPhoto(localId, { status: 'error', error: 'PDF is not supported yet — upload a photo or screenshot of it' });
      return;
    }
    let image: CompressedImage;
    try {
      image = await compressImage(file, RECEIPT_PROFILE);
    } catch {
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      patchPhoto(localId, {
        status: 'error',
        error: heic ? 'This browser cannot open HEIC photos — choose JPG, or take the photo here' : 'This file could not be opened as a photo',
      });
      return;
    }
    const url = URL.createObjectURL(image.blob);
    urls.current.push(url);
    images.current.set(localId, image);
    previewUrls.current.set(localId, url);
    patchPhoto(localId, { previewUrl: url });
    await upload(localId, image);
  }

  function blankPhoto(): ReceiptPhoto {
    return {
      localId: newLocalId(), previewUrl: null, status: 'processing', progress: 0, attachmentId: null, error: null,
      analyzed: false, readable: null, note: null, saved: false,
    };
  }

  function addFiles(files: File[]) {
    const room = AI_CAPTURE_MAX_PHOTOS - photos.filter((p) => !p.saved).length;
    if (files.length > room) toast.warning(`Only ${room} more photo${room === 1 ? '' : 's'} can be added — read these first.`);
    const take = files.slice(0, Math.max(0, room));
    const fresh = take.map(() => blankPhoto());
    setPhotos((list) => [...list, ...fresh]);
    take.forEach((file, i) => void prepare(fresh[i]!.localId, file));
  }

  function removePhoto(localId: string) {
    const p = photos.find((x) => x.localId === localId);
    if (!p || p.saved) return;
    if (p.attachmentId) {
      if (token) void discardAttachment(p.attachmentId, token);
      // Cards read from it lose it; one left with no photo cannot be saved until a photo is added back.
      setDrafts((list) => list.map((d) => (d.status === 'saved' ? d : { ...d, photoIds: d.photoIds.filter((id) => id !== p.attachmentId) })));
    }
    setPhotos((list) => list.filter((x) => x.localId !== localId));
  }

  function replacePhoto(localId: string, file: File) {
    const at = photos.findIndex((x) => x.localId === localId);
    removePhoto(localId);
    const fresh = blankPhoto();
    setPhotos((list) => {
      const next = [...list];
      next.splice(Math.max(0, at), 0, fresh);
      return next;
    });
    void prepare(fresh.localId, file);
  }

  function retryPhoto(localId: string) {
    const image = images.current.get(localId);
    if (image) void upload(localId, image);
  }

  function markRead(result: { photos: { id: string; readable: boolean; note: string | null }[] }) {
    const byId = new Map(result.photos.map((p) => [p.id, p]));
    setPhotos((list) => list.map((p) => {
      const r = p.attachmentId ? byId.get(p.attachmentId) : undefined;
      return r ? { ...p, analyzed: true, readable: r.readable, note: r.note } : p;
    }));
  }

  async function generate() {
    const ids = pendingPhotos.map((p) => p.attachmentId!);
    if (ids.length === 0) return;
    try {
      const result = await analyze.mutateAsync(ids);
      markRead(result);
      const fresh = result.expenses.map((e) => draftFromProposal(e, result.captureId));
      setDrafts((list) => [...list, ...fresh]);
      if (fresh.length === 0) toast.warning('No bills could be read from these photos. Try clearer photos.');
      else toast.success(`${fresh.length} expense${fresh.length === 1 ? '' : 's'} read — check each one, then approve and save.`);
    } catch (err) {
      toast.error(errorText(err, 'The receipts could not be read. Try again.'));
    }
  }

  async function regenerate(key: string) {
    const d = drafts.find((x) => x.key === key);
    if (!d || d.photoIds.length === 0) return;
    try {
      const result = await analyze.mutateAsync(d.photoIds);
      markRead(result);
      const fresh = result.expenses.map((e) => draftFromProposal(e, result.captureId));
      setDrafts((list) => list.flatMap((x) => (x.key === key ? fresh : [x])));
      toast.success(fresh.length === 1 ? 'Read again.' : `Read again: ${fresh.length} expenses.`);
    } catch (err) {
      toast.error(errorText(err, 'The receipt could not be read again.'));
    }
  }

  function runAction(key: string, action: CardAction) {
    if (action === 'regenerate') void regenerate(key);
    else if (typeof action === 'object') setConfirm({ kind: 'combine', key, otherKey: action.combineWith });
    else setConfirm({ kind: action, key });
  }

  function confirmAction() {
    if (!confirm) return;
    const { kind, key, otherKey } = confirm;
    setConfirm(null);
    if (kind === 'delete') {
      setDrafts((list) => list.filter((d) => d.key !== key));
    } else if (kind === 'split') {
      setDrafts((list) => list.flatMap((d) => (d.key === key ? splitDraft(d) : [d])));
    } else if (kind === 'combine' && otherKey) {
      setDrafts((list) => {
        const a = list.find((d) => d.key === key);
        const b = list.find((d) => d.key === otherKey);
        if (!a || !b || !canCombine(a, b)) return list;
        const merged = combineDrafts(a, b);
        return list.flatMap((d) => (d.key === key ? [merged] : d.key === otherKey ? [] : [d]));
      });
    }
  }

  async function saveApproved() {
    if (!token || approved.length === 0) return;
    setSaving(true);
    // Photos already on an entry saved here — a later card reusing one (a split
    // bill) gets its own copy, since a photo row supports one entry.
    const claimed = new Set(drafts.filter((d) => d.status === 'saved').flatMap((d) => d.photoIds));
    let savedCount = 0;
    for (const d of approved) {
      patchDraft(d.key, { status: 'saving', error: null });
      try {
        const ids: string[] = [];
        for (const id of d.photoIds) {
          if (!claimed.has(id)) { ids.push(id); continue; }
          const copy = await copyReceiptPhoto(id, token);
          setThumbs((m) => (m.get(id) ? new Map(m).set(copy.id, m.get(id)!) : m));
          ids.push(copy.id);
        }
        // Kept on the card, so a retry sends the same body under the same key.
        patchDraft(d.key, { photoIds: ids });
        const { entry } = await save.mutateAsync({
          path: '/api/finance/income/entries',
          body: createBody(d, ids),
          headers: { 'Idempotency-Key': d.idempotencyKey },
        });
        for (const id of ids) claimed.add(id);
        patchDraft(d.key, { status: 'saved', savedTxnNo: entry.txnNo, photoIds: ids });
        setPhotos((list) => list.map((p) => (p.attachmentId && ids.includes(p.attachmentId) ? { ...p, saved: true } : p)));
        savedCount++;
      } catch (err) {
        const message = err instanceof ApiError || err instanceof Error ? err.message : 'Could not save this expense';
        patchDraft(d.key, { status: 'review', error: message });
      }
    }
    setSaving(false);
    if (savedCount > 0) {
      toast.success(
        `${savedCount} expense${savedCount === 1 ? '' : 's'} saved as draft${savedCount === 1 ? '' : 's'} — ${
          financeCanReview(user?.role) ? 'submit them for approval from Income & Expense' : 'the Accountant will check and submit them'
        }.`,
      );
    }
    if (savedCount < approved.length) toast.error('Some expenses were not saved — see the message on each card.');
  }

  function openReceipt(ids: string[]) {
    const list = ids.map((id) => thumbs.get(id)).filter((u): u is string => Boolean(u));
    if (list.length > 0) setPreview({ urls: list, index: 0 });
    else toast.info('This receipt is not on this page any more.');
  }

  const stepNow = analyze.isPending ? 1 : uploading ? 0 : drafts.length > 0 ? 2 : -1;
  const combineLabels = useMemo(() => new Map(drafts.map((d, i) => [d.key, `Expense ${String(i + 1).padStart(2, '0')}`])), [drafts]);

  if (!abilities.loading && !abilities.create) {
    return (
      <div className="space-y-4">
        <FinancePageHeader title="AI Expense Capture" />
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          Your role ({abilities.roleLabel || 'read-only'}) cannot raise entries, so it cannot use AI Expense Capture.
        </p>
      </div>
    );
  }

  const actions = (
    <>
      <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={busy || uploading || pendingPhotos.length === 0} onClick={() => void generate()}>
        {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {analyze.isPending ? 'Reading…' : `Generate Expenses${pendingPhotos.length > 0 ? ` (${pendingPhotos.length})` : ''}`}
      </Button>
      <Button type="button" className="h-11 sm:h-9" disabled={busy || approved.length === 0} onClick={() => void saveApproved()}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />}
        {saving ? 'Saving…' : `Save Approved${approved.length > 0 ? ` (${approved.length})` : ''}`}
      </Button>
    </>
  );

  return (
    <div className="space-y-4 pb-24 sm:pb-0">
      <FinancePageHeader
        title="AI Expense Capture"
        description="Photograph or upload receipts; the AI reads each bill into an expense for you to check. Saved expenses are drafts in Income & Expense, approved as usual."
        actions={<div className="hidden gap-2 sm:flex">{actions}</div>}
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Total receipts', String(summary.receipts)],
          ['Generated expenses', String(summary.expenses)],
          ['Total expense amount', null],
          ['Needing verification', String(summary.needingReview)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn('text-lg font-semibold tabular-nums', label === 'Needing verification' && summary.needingReview > 0 && 'text-amber-700 dark:text-amber-400')}>
              {value ?? <Money value={summary.totalAmount} />}
            </p>
          </div>
        ))}
      </section>

      {stepNow >= 0 && (
        <ol aria-label="Progress" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className={cn('flex items-center gap-1.5', i === stepNow ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {i < stepNow || (i === 2 && stepNow === 2) ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : i === stepNow ? <Loader2 className="size-3.5 animate-spin" /> : <Circle className="size-3.5" />}
              {s}
              {i === 0 && uploading && ` (${photos.filter((p) => p.status === 'ready').length}/${photos.length})`}
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Receipts" className="space-y-2">
          <h3 className="text-sm font-semibold">Receipts</h3>
          <ReceiptUploader
            photos={photos}
            disabled={busy}
            onAdd={addFiles}
            onRemove={removePhoto}
            onReplace={replacePhoto}
            onRetry={retryPhoto}
            onPreview={(localId) => {
              const i = photos.findIndex((p) => p.localId === localId);
              const list = photos.map((p) => p.previewUrl).filter((u): u is string => Boolean(u));
              const url = photos[i]?.previewUrl;
              if (url) setPreview({ urls: list, index: Math.max(0, list.indexOf(url)) });
            }}
          />
        </section>

        <section aria-label="Generated expenses" className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Generated expenses</h3>
            {summary.saved > 0 && (
              <Link href={ROUTES.FINANCE_ENTRIES} className="text-xs text-primary hover:underline">Open Income & Expense →</Link>
            )}
          </div>
          {analyze.isPending && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the receipts line by line, separating the bills and checking the totals… this can take up to a minute.
            </div>
          )}
          {drafts.length === 0 && !analyze.isPending && (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Add receipt photos, then press <span className="font-medium text-foreground">Generate Expenses</span>. Each bill becomes one expense to check here; nothing is saved until you approve and save it.
            </p>
          )}
          {drafts.map((d, i) => (
            <AiExpenseCard
              key={d.key}
              draft={d}
              index={i}
              heads={heads}
              branches={branches}
              thumbs={thumbs}
              busy={busy}
              combineOptions={drafts.filter((o) => canCombine(d, o)).map((o) => ({ key: o.key, label: combineLabels.get(o.key) ?? 'another' }))}
              onChange={(patch) => patchDraft(d.key, { ...patch, ...(d.status === 'approved' && !('duplicateAcknowledged' in patch) ? { status: 'review' } : {}), error: null })}
              onApprove={(yes) => patchDraft(d.key, { status: yes ? 'approved' : 'review', error: null })}
              onAction={(a) => runAction(d.key, a)}
              onViewReceipt={() => openReceipt(d.photoIds)}
            />
          ))}
        </section>
      </div>

      {/* Phone: the two actions stay in reach at the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 gap-2 border-t bg-background/95 p-3 backdrop-blur sm:hidden">
        {actions}
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[95dvh] overflow-y-auto md:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receipt{preview && preview.urls.length > 1 ? ` ${preview.index + 1} of ${preview.urls.length}` : ''}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL or a signed URL */}
              <img src={preview.urls[preview.index]} alt="Receipt" className="mx-auto max-h-[75dvh] w-auto rounded-md border object-contain" />
              {preview.urls.length > 1 && (
                <div className="flex justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={preview.index === 0} onClick={() => setPreview({ ...preview, index: preview.index - 1 })}><ChevronLeft /> Previous</Button>
                  <Button type="button" variant="outline" size="sm" disabled={preview.index === preview.urls.length - 1} onClick={() => setPreview({ ...preview, index: preview.index + 1 })}>Next <ChevronRight /></Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'delete' ? 'Delete this expense?' : confirm?.kind === 'split' ? 'Split this bill into two expenses?' : 'Combine these into one expense?'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'delete'
                ? 'It is removed from this page only; nothing has been saved for it. Its receipt photo stays on the left.'
                : confirm?.kind === 'split'
                  ? 'Both keep the same receipt photo. The new one starts with no amount — enter each part so they add up to the bill.'
                  : `${combineLabels.get(confirm?.otherKey ?? '') ?? 'The other expense'} is merged into ${combineLabels.get(confirm?.key ?? '') ?? 'this one'}: their photos and items together, the amounts added. Check the result before approving it.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button type="button" variant={confirm?.kind === 'delete' ? 'destructive' : 'default'} onClick={confirmAction}>
              {confirm?.kind === 'delete' ? 'Delete' : confirm?.kind === 'split' ? 'Split' : 'Combine'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
