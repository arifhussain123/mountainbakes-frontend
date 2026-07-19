'use client';

import { useRef, useState, type ChangeEvent, type ElementType } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  exportCurrentPriceList,
  exportCategoryWiseProducts,
  previewImport,
  saveImport,
} from '@/utils/productPrice';
import type { ImportPreviewResult } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Upload, CheckCircle2, AlertTriangle, MinusCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function karachiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
}

export function PriceListPage() {
  const { user, token } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<'excel' | 'csv' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(karachiToday());
  const [reason, setReason] = useState('');

  if (user && user.role !== 'super_admin') {
    return <p className="py-12 text-center text-sm text-muted-foreground">Access denied — Super Admin only.</p>;
  }

  async function exportList(type: 'excel' | 'csv', groupByCategory = false) {
    setExporting(type);
    try {
      if (groupByCategory) await exportCategoryWiseProducts(type, { token });
      else await exportCurrentPriceList(type, { token });
      toast.success(`${groupByCategory ? 'Category-wise list' : 'Price list'} exported (${type.toUpperCase()})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    try {
      const result = await previewImport(file, { token });
      setPreview(result);
      setEffectiveDate(karachiToday());
      setReason('');
      setPreviewOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the file');
    } finally {
      setUploading(false);
    }
  }

  async function commit() {
    if (!preview || preview.validRows.length === 0) return;
    if (!reason.trim()) { toast.error('Please enter a reason'); return; }
    setCommitting(true);
    try {
      // saveImport invalidates products + price history, so every open screen
      // reflects the new prices — a bulk import previously refreshed nothing.
      const res = await saveImport(
        {
          rows: preview.validRows.map((r) => ({ productId: r.productId, newPrice: r.newPrice })),
          effectiveDate,
          reason: reason.trim(),
        },
        { token },
      );
      toast.success(`Imported — ${res.appliedImmediate} applied, ${res.scheduled} scheduled`);
      setPreviewOpen(false);
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setCommitting(false);
    }
  }

  const validCount = preview?.validRows.length ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Export Price List</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted-foreground">Download the current price list — edit it and re-import to bulk-update.</p>
          <Button variant="outline" onClick={() => exportList('excel')} disabled={exporting !== null}>
            {exporting === 'excel' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />} Export Excel
          </Button>
          <Button variant="outline" onClick={() => exportList('csv')} disabled={exporting !== null}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Export by Category</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted-foreground">
            Same columns, grouped and sorted by category — still a valid re-import template.
          </p>
          <Button variant="outline" onClick={() => exportList('excel', true)} disabled={exporting !== null}>
            <Download className="mr-1.5 h-4 w-4" /> Export Excel
          </Button>
          <Button variant="outline" onClick={() => exportList('csv', true)} disabled={exporting !== null}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Import Price List</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-sm text-muted-foreground">
            Upload an Excel/CSV with <span className="font-medium text-foreground">Product Code</span> and{' '}
            <span className="font-medium text-foreground">Current Price</span> columns. You&apos;ll preview before saving.
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={onFile} />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />} Import Price List
          </Button>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={(o) => !committing && setPreviewOpen(o)}>
        <DialogContent className="flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 top-0 left-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90vh] sm:w-[92vw] sm:max-w-[820px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4"><DialogTitle>Review Price Import</DialogTitle></DialogHeader>

          {preview && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-3 gap-3">
                <SummaryStat icon={CheckCircle2} label="Will update" value={preview.summary.valid} tone="emerald" />
                <SummaryStat icon={MinusCircle} label="Unchanged" value={preview.summary.unchanged} tone="muted" />
                <SummaryStat icon={AlertTriangle} label="Errors" value={preview.summary.errors} tone="red" />
              </div>

              {preview.validRows.length > 0 && (
                <PreviewSection title={`Will update (${preview.validRows.length})`}>
                  <MiniTable
                    head={['Code', 'Product', 'Current', 'New']}
                    rows={preview.validRows.map((r) => [r.productCode, r.productName, `Rs.${r.currentPrice.toLocaleString()}`, `Rs.${r.newPrice.toLocaleString()}`])}
                  />
                </PreviewSection>
              )}

              {preview.errorRows.length > 0 && (
                <PreviewSection title={`Errors — skipped (${preview.errorRows.length})`}>
                  <MiniTable
                    head={['Row', 'Code', 'Value', 'Problem']}
                    rows={preview.errorRows.map((r) => [r.rowNumber, r.productCode || '—', r.rawPrice || '—', r.message])}
                  />
                </PreviewSection>
              )}

              {preview.unchangedRows.length > 0 && (
                <PreviewSection title={`Unchanged (${preview.unchangedRows.length})`}>
                  <MiniTable
                    head={['Code', 'Product', 'Price']}
                    rows={preview.unchangedRows.map((r) => [r.productCode, r.productName, `Rs.${r.price.toLocaleString()}`])}
                  />
                </PreviewSection>
              )}

              {validCount > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Effective Date</Label>
                    <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Reason</Label>
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier price increase" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No valid price changes to apply in this file.</p>
              )}
            </div>
          )}

          <div className="shrink-0 flex flex-col gap-2 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={committing}>Cancel</Button>
            <Button onClick={commit} disabled={committing || validCount === 0}>
              {committing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Apply {validCount} change{validCount === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value, tone }: { icon: ElementType; label: string; value: number; tone: 'emerald' | 'red' | 'muted' }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-500' : 'text-muted-foreground';
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <Icon className={`mx-auto h-5 w-5 ${toneCls}`} />
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneCls}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-medium' : ''}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
