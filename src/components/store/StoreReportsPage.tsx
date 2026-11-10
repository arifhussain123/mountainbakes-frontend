'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import type { StoreReportColumn, StoreReportType } from '@mb/shared';
import { STORE_REPORTS, STORE_REPORT_TYPES } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { downloadStoreReport, useStoreItems, useStoreReport } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  DateRange, ErrorBlock, FilterSelect, StorePage, errorMessage, fd, num, presetRange, rate, rs, useStoreSession, type RangePreset,
} from './parts';

/**
 * Store Reports (spec §14). Ten reports over one table: the columns come from
 * STORE_REPORTS, which the API's Excel export reads too, so the screen and
 * the file always agree.
 */

type Row = Record<string, unknown>;
const col = createColumnHelper<Row>();
const LAST_TYPE_KEY = 'mb.store.reports.type';

const isNumeric = (c: StoreReportColumn) => c.kind === 'qty' || c.kind === 'money' || c.kind === 'rate';

function readLastType(): StoreReportType {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_TYPE_KEY) : null;
    if (v && (STORE_REPORT_TYPES as readonly string[]).includes(v)) return v as StoreReportType;
  } catch {
    // Storage blocked (private mode): fall back to the first report.
  }
  return STORE_REPORT_TYPES[0];
}

function format(c: StoreReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.kind) {
    case 'date': return fd(String(v));
    case 'money': return rs(Number(v));
    case 'rate': return rate(Number(v));
    case 'qty': return num(Number(v));
    default: return String(v);
  }
}

export function StoreReportsPage() {
  const session = useStoreSession();
  const { token, today } = session;

  const [type, setType] = useState<StoreReportType>(readLastType);
  const [preset, setPreset] = useState<RangePreset>('month');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [itemId, setItemId] = useState('');
  const [exporting, setExporting] = useState(false);

  const def = STORE_REPORTS[type];
  const range = preset === 'custom' ? custom : presetRange(preset, today) ?? { from: '', to: '' };
  // An undated report ("as of now") still sends a range; the API ignores it.
  const from = def.dated ? range.from : today;
  const to = def.dated ? range.to : today;

  const itemsQ = useStoreItems(token, true);
  const reportQ = useStoreReport(token, type, from, to, itemId || null);
  const rows = useMemo(() => reportQ.data?.rows ?? [], [reportQ.data]);
  const itemName = itemId ? (itemsQ.data ?? []).find((i) => i.id === itemId)?.name : null;

  const pickType = (v: string) => {
    const t = v as StoreReportType;
    setType(t);
    try { window.localStorage.setItem(LAST_TYPE_KEY, t); } catch { /* storage blocked: not remembered */ }
  };

  const columns = useMemo(() => {
    const titleKey = def.columns.find((c) => !c.kind || c.kind === 'text')?.key;
    return def.columns.map((c) => {
      const numeric = isNumeric(c);
      return col.accessor((r) => (numeric ? Number(r[c.key] ?? 0) : String(r[c.key] ?? '')), {
        id: c.key,
        header: c.header,
        sortingFn: numeric || c.kind === 'date' ? 'basic' : 'text',
        meta: {
          align: numeric || c.kind === 'date' ? 'center' : undefined,
          mobile: c.key === titleKey ? 'title' : c.kind === 'money' ? 'figure' : undefined,
        },
        cell: (x) => {
          const text = format(c, x.row.original[c.key]);
          if (numeric) return <span className={cn(c.kind === 'money' && 'font-semibold', 'whitespace-nowrap tabular-nums')}>{text}</span>;
          if (c.kind === 'date') return <span className="whitespace-nowrap tabular-nums">{text}</span>;
          return <span className={c.key === titleKey ? 'font-semibold' : undefined}>{text}</span>;
        },
      });
    });
  }, [def]);

  const totals = useMemo(() => def.columns
    .filter((c) => c.kind === 'money')
    .map((c) => ({ key: c.key, header: c.header, sum: rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0) })), [def, rows]);

  const exportXlsx = async () => {
    if (!from || !to) return;
    setExporting(true);
    try {
      await downloadStoreReport(token, type, from, to, itemId || null);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not export this report. Try again.'));
    } finally {
      setExporting(false);
    }
  };

  const rangeText = def.dated
    ? (from && to ? (from === to ? fd(from) : `${fd(from)} – ${fd(to)}`) : '')
    : `as of now${today ? ` (${fd(today)})` : ''}`;

  return (
    <StorePage session={session} subtitle="Store reports. Every report exports to Excel with the same columns." needs="reports">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Report" value={type} onChange={pickType} className="max-w-full font-semibold">
          {STORE_REPORT_TYPES.map((t) => <option key={t} value={t}>{STORE_REPORTS[t].label}</option>)}
        </FilterSelect>
        <FilterSelect label="Item" value={itemId} onChange={setItemId} className="max-w-[220px]">
          <option value="">All items</option>
          {(itemsQ.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} · {i.itemNo}{i.status === 'active' ? '' : ' (inactive)'}</option>)}
        </FilterSelect>
        <Button variant="outline" className="sm:ml-auto" onClick={() => void exportXlsx()} disabled={exporting || !from || !to}>
          {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />}
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </Button>
      </div>
      {def.dated && (
        <DateRange
          today={today}
          from={range.from}
          to={range.to}
          preset={preset}
          onChange={(n) => { setPreset(n.preset); if (n.preset === 'custom') setCustom({ from: n.from, to: n.to }); }}
        />
      )}

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-base font-bold">{def.label}</h2>
        <span className="text-sm text-muted-foreground">
          {rangeText}{itemName ? ` · ${itemName}` : ''}{reportQ.data ? ` · ${rows.length} row${rows.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {reportQ.isError ? (
        <ErrorBlock error={reportQ.error} onRetry={() => void reportQ.refetch()} />
      ) : (
        <>
          {totals.length > 0 && rows.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-2xl border border-border bg-card px-4 py-3 text-[13.5px] text-muted-foreground">
              {totals.map((t) => (
                <span key={t.key}>{t.header} <b className="ml-1 text-[15px] tabular-nums text-foreground">{rs(t.sum)}</b></span>
              ))}
            </div>
          )}
          <DataTable
            key={type}
            columns={columns}
            data={rows}
            loading={reportQ.isLoading || (!from && !reportQ.isError)}
            sortable
            toolbar={false}
            pageSize={50}
            dense={def.columns.length > 10}
            empty={<EmptyState icon={FileText} title="No rows in this range." description={def.dated ? 'Pick a wider range or another item.' : 'Nothing is in store for this filter.'} />}
          />
        </>
      )}
    </StorePage>
  );
}
