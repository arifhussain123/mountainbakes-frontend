'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import type { StoreItemImportCommitRow, StoreItemImportPreview } from '@mb/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadStoreItems, previewStoreItemImport, useCommitStoreItemImport } from '@/lib/store';
import { Pill, errorMessage } from './parts';

/**
 * Bulk item import. Two-phase so nothing is written until the operator sees
 * exactly what will change: pick a file → server validates it into a preview
 * (new / updated / errors) → confirm → commit. The downloaded list is the
 * template, so a round-trip edit re-imports cleanly.
 */
export function StoreItemImportDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoreItemImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = useCommitStoreItemImport(token);
  const busy = parsing || commit.isPending;

  async function onPick(file: File | null) {
    setPreview(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    setParsing(true);
    try {
      setPreview(await previewStoreItemImport(token, file));
    } catch (e) {
      toast.error(errorMessage(e));
      setFileName(null);
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = ''; // let the same file be re-picked
    }
  }

  async function onDownloadTemplate() {
    setDownloading(true);
    try {
      await downloadStoreItems(token, 'excel');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  const rows = preview?.rows ?? [];
  const toCommit: StoreItemImportCommitRow[] = rows.map((r) => ({
    id: r.id,
    itemCode: r.itemCode,
    name: r.name,
    category: r.category,
    baseUnit: r.baseUnit,
    purchaseUnit: r.purchaseUnit,
    conversionQty: r.conversionQty,
    minStock: r.minStock,
    remarks: r.remarks,
  }));

  function apply() {
    if (!toCommit.length) return;
    commit.mutate(toCommit, {
      onSuccess: (res) => {
        const bits = [res.created ? `${res.created} added` : '', res.updated ? `${res.updated} updated` : '']
          .filter(Boolean)
          .join(', ');
        if (res.failed.length) {
          toast.warning(`${bits || 'Imported'} · ${res.failed.length} could not be saved (${res.failed[0]?.message})`);
        } else {
          toast.success(bits ? `Items imported — ${bits}.` : 'Nothing to import.');
        }
        onClose();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  const s = preview?.summary;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="md:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Upload Items from Excel</DialogTitle>
          <DialogDescription>
            Download the current list, edit it, and upload it back. Rows are matched by <b>Item Code</b> — existing codes
            are updated, new codes are added. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            <UploadCloud className="mr-1.5 h-4 w-4" />
            {fileName ? 'Choose a different file' : 'Choose Excel file'}
          </Button>
          <Button variant="ghost" onClick={() => void onDownloadTemplate()} disabled={downloading || busy}>
            <Download className="mr-1.5 h-4 w-4" />
            {downloading ? 'Preparing…' : 'Download template'}
          </Button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              {fileName}
            </span>
          )}
        </div>

        {parsing && <Skeleton className="h-40 w-full rounded-lg" />}

        {s && !parsing && (
          <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap gap-2">
              <Pill tone="green">{s.create} new</Pill>
              <Pill tone="blue">{s.update} updated</Pill>
              {s.unchanged > 0 && <Pill tone="muted">{s.unchanged} unchanged</Pill>}
              {s.errors > 0 && <Pill tone="red">{s.errors} with errors</Pill>}
              <span className="ml-auto self-center text-xs text-muted-foreground">{s.total} rows read</span>
            </div>

            {preview!.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4" />
                  These rows will be skipped
                </div>
                <ul className="flex flex-col gap-1 text-sm text-red-800 dark:text-red-200">
                  {preview!.errors.map((e, i) => (
                    <li key={`${e.rowNumber}-${i}`}>
                      <span className="font-mono text-xs">Row {e.rowNumber}</span>
                      {e.itemCode ? <span className="font-mono text-xs"> · {e.itemCode}</span> : null} — {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rows.length > 0 ? (
              <div className="divide-y overflow-hidden rounded-lg border">
                {rows.map((r) => (
                  <div key={`${r.rowNumber}-${r.itemCode}`} className="flex items-start gap-3 p-2.5">
                    <Pill tone={r.action === 'create' ? 'green' : 'blue'} className="mt-0.5 shrink-0">
                      {r.action === 'create' ? 'New' : 'Update'}
                    </Pill>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{r.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{r.itemCode}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.category} · {r.baseUnit} · 1 {r.purchaseUnit} = {r.conversionQty} {r.baseUnit}
                        </span>
                      </div>
                      {r.changes.length > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{r.changes.join(' · ')}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              preview!.errors.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Nothing to import — every row already matches what is stored.
                </p>
              )
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy || toCommit.length === 0}>
            {commit.isPending ? 'Saving…' : `Import ${toCommit.length} item${toCommit.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
