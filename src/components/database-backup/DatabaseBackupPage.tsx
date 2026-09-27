'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { BackupJob, BackupType, BackupTypeHealth, BackupVerifyResult } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBackupDownloadUrl, useBackupHistory, useBackupStatus, useLatestRestoreTest, useRunBackup, useVerifyBackup } from '@/lib/queries';
import { ApiError } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { CalendarClock, CheckCircle2, Database, Download, HardDriveDownload, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { HEALTH_LABELS, HEALTH_STYLES, STATUS_LABELS, STATUS_STYLES, TYPE_LABELS, formatBytes, formatDuration, keyFileName, shortChecksum } from './backupFormat';

/**
 * Admin → Database Backup.
 *
 * Three cards, one per scheduled class, answer the only question this screen
 * exists for: "do we have a recent, VERIFIED backup?" — then the history
 * table shows every run, verified or not, so a failure is visible rather than
 * buried in a Scheduler log.
 *
 * Everything shown here is metadata: sizes, keys, checksums, times. No
 * connection string or key ever reaches this screen. A download is a
 * five-minute presigned link the API issues on request and logs; the link is
 * never stored.
 *
 * "Create backup" only ever CREATES a backup (a manual one, in its own S3
 * folder with its own retention). Nothing on this screen can delete anything —
 * retention is an S3 Lifecycle rule and a CLI dry run, on purpose.
 */

const col = createColumnHelper<BackupJob>();

function StatusBadge({ status }: { status: BackupJob['status'] }) {
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[status])}>{STATUS_LABELS[status]}</span>;
}

function HealthCard({ type, health, job, schedule, retentionDays }: { type: Exclude<BackupType, 'manual'>; health: BackupTypeHealth; job: BackupJob | null; schedule: string; retentionDays: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{TYPE_LABELS[type]} Backup</CardTitle>
            <CardDescription>
              {schedule} · kept {retentionDays} days
            </CardDescription>
          </div>
          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', HEALTH_STYLES[health.status])}>{HEALTH_LABELS[health.status]}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Row label="Last verified" value={health.lastSuccessfulAt ? `${formatDateTime(health.lastSuccessfulAt)} (${health.ageHours}h ago)` : 'never'} />
        <Row label="Last run" value={job ? <span className="inline-flex items-center gap-2">{formatDateTime(job.startedAt)} <StatusBadge status={job.status} /></span> : '—'} />
        <Row label="Size" value={job?.fileSize ? `${formatBytes(job.fileSize)} + ${formatBytes(job.authFileSize)} auth` : '—'} />
        <Row label="S3 location" value={<span className="font-mono text-xs break-all" title={job?.s3Key ?? undefined}>{keyFileName(job?.s3Key)}</span>} />
        <Row label="Retention until" value={job?.retentionUntil ? formatDateTime(job.retentionUntil) : '—'} />
        <Row label="SHA-256" value={<span className="font-mono text-xs" title={job?.checksumSha256 ?? undefined}>{shortChecksum(job?.checksumSha256)}</span>} />
        {job?.errorCategory && <p className="text-xs text-red-600 dark:text-red-400">{job.errorCategory}: {job.errorMessage}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right min-w-0">{value}</span>
    </div>
  );
}

export function DatabaseBackupPage() {
  const { token } = useAuth();
  const statusQ = useBackupStatus(token);
  const historyQ = useBackupHistory(token, { page: 1, pageSize: 100 });
  const restoreQ = useLatestRestoreTest(token);
  const verify = useVerifyBackup(token);
  const run = useRunBackup(token);
  const download = useBackupDownloadUrl(token);
  const [detail, setDetail] = useState<BackupJob | null>(null);
  const [verifyResult, setVerifyResult] = useState<BackupVerifyResult | null>(null);

  const status = statusQ.data;
  const notConfigured = statusQ.error instanceof ApiError && statusQ.error.status === 503;

  async function onVerify(job: BackupJob) {
    try {
      const res = await verify.mutateAsync(job.id);
      setVerifyResult(res);
      if (res.ok) toast.success(`${job.backupId} verified — every check passed`);
      else toast.error(`${job.backupId} failed verification`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    }
  }

  async function onDownload(job: BackupJob, file: 'main' | 'auth') {
    try {
      const res = await download.mutateAsync({ id: job.id, file });
      window.open(res.url, '_blank', 'noopener');
      toast.info(`Download link for ${res.fileName} is valid for ${Math.round(res.expiresInSeconds / 60)} minutes`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not issue a download link');
    }
  }

  async function onCreateManual() {
    try {
      const res = await run.mutateAsync({ type: 'manual' });
      if (res.outcome === 'started') toast.success('Manual backup started — it will appear below as it completes');
      else toast.info(res.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the backup');
    }
  }

  const columns = [
    col.accessor('startedAt', {
      id: 'date',
      header: 'Date',
      meta: { mobile: 'title' },
      cell: (i) => <span className="whitespace-nowrap">{formatDateTime(i.getValue())}</span>,
    }),
    col.accessor('backupType', { id: 'type', header: 'Type', meta: { mobile: 'subtitle' }, cell: (i) => TYPE_LABELS[i.getValue()] }),
    col.accessor('status', { id: 'status', header: 'Status', meta: { mobile: 'badge' }, cell: (i) => <StatusBadge status={i.getValue()} /> }),
    col.accessor('backupId', { id: 'backupId', header: 'Backup ID', cell: (i) => <span className="font-mono text-xs">{i.getValue()}</span> }),
    col.accessor('fileSize', { id: 'size', header: 'Size', meta: { align: 'right' }, cell: (i) => <span className="tabular-nums">{formatBytes(i.getValue())}</span> }),
    col.accessor('durationMs', { id: 'duration', header: 'Duration', meta: { align: 'right' }, cell: (i) => <span className="tabular-nums">{formatDuration(i.getValue())}</span> }),
    col.accessor((j) => j.s3Key ?? '', {
      id: 's3Key',
      header: 'S3 Key',
      meta: { mobileFull: true },
      cell: ({ row }) => <span className="font-mono text-xs break-all" title={row.original.s3Key ?? undefined}>{row.original.s3Key ?? '—'}</span>,
    }),
    col.accessor('retentionUntil', { id: 'retention', header: 'Retention Until', cell: (i) => <span className="whitespace-nowrap">{i.getValue() ? formatDateTime(i.getValue()) : '—'}</span> }),
    col.accessor('checksumSha256', { id: 'checksum', header: 'SHA-256', cell: (i) => <span className="font-mono text-xs" title={i.getValue() ?? undefined}>{shortChecksum(i.getValue())}</span> }),
    col.display({
      id: 'actions',
      header: '',
      meta: { mobile: 'actions' },
      cell: ({ row }) => {
        const job = row.original;
        const done = job.status === 'verified' || job.status === 'success';
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDetail(job)} title="View">
              View
            </Button>
            <Button variant="ghost" size="sm" disabled={!done || verify.isPending} onClick={() => onVerify(job)} title="Re-check this backup against S3">
              <ShieldCheck className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" disabled={!done || download.isPending} onClick={() => onDownload(job, 'main')} title="Download (5-minute link)">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Database Backup</h1>
          <p className="text-sm text-muted-foreground">
            PostgreSQL dumps of the Supabase database, encrypted in S3
            {status ? ` at s3://${status.storage.bucket}/${status.storage.prefix}/ (${status.schedule.timezone})` : ''}. Only a verified backup counts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { statusQ.refetch(); historyQ.refetch(); }} disabled={statusQ.isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', statusQ.isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={onCreateManual} disabled={run.isPending || notConfigured}>
            <HardDriveDownload className="h-4 w-4 mr-1" /> Create backup
          </Button>
        </div>
      </div>

      {notConfigured && (
        <Card className="border-amber-300">
          <CardContent className="p-4 text-sm">
            The backup system is not configured on this server yet (missing environment). See <span className="font-mono">docs/database-backup.md</span> in the backend repository.
          </CardContent>
        </Card>
      )}

      {statusQ.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : status ? (
        <div className="grid gap-4 md:grid-cols-3">
          {(['daily', 'weekly', 'monthly'] as const).map((t) => (
            <HealthCard key={t} type={t} health={status.health[t]} job={status.latest[t]} schedule={status.schedule[t]} retentionDays={status.retention[`${t}Days`]} />
          ))}
        </div>
      ) : null}

      {status && (
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Database className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Running now</p>
                <p className="font-medium">{status.running.length === 0 ? 'Nothing' : status.running.map((r) => r.backupId).join(', ')}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              {status.health.recentFailures > 0 ? <XCircle className="h-5 w-5 text-red-500" /> : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
              <div>
                <p className="text-muted-foreground">Failures, last 7 days</p>
                <p className="font-medium">{status.health.recentFailures}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CalendarClock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Last restore test</p>
                <p className="font-medium">
                  {restoreQ.data?.restoreTest ? `${formatDateTime(restoreQ.data.restoreTest.startedAt)} — ${restoreQ.data.restoreTest.status}` : 'never'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <DataTable
        columns={columns}
        data={historyQ.data?.jobs ?? []}
        loading={historyQ.isLoading}
        searchPlaceholder="Search backups…"
        pageSize={20}
        sortable
        empty={<EmptyState title="No backups yet" description="The first scheduled run will appear here, or create a manual backup now." />}
      />

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{detail?.backupId}</DialogTitle>
            <DialogDescription>{detail ? `${TYPE_LABELS[detail.backupType]} backup · ${STATUS_LABELS[detail.status]} · triggered by ${detail.triggeredByName ?? detail.trigger}` : ''}</DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
              {(
                [
                  ['Started', formatDateTime(detail.startedAt)],
                  ['Completed', detail.completedAt ? formatDateTime(detail.completedAt) : '—'],
                  ['Duration', `${formatDuration(detail.durationMs)} (dump ${formatDuration(detail.dumpMs)}, upload ${formatDuration(detail.uploadMs)})`],
                  ['Bucket', detail.s3Bucket],
                  ['Main archive', detail.s3Key ?? '—'],
                  ['Main size', formatBytes(detail.fileSize)],
                  ['Main SHA-256', detail.checksumSha256 ?? '—'],
                  ['Auth archive', detail.authS3Key ?? '—'],
                  ['Auth size', formatBytes(detail.authFileSize)],
                  ['Auth SHA-256', detail.authChecksumSha256 ?? '—'],
                  ['Manifest', detail.manifestS3Key ?? '—'],
                  ['Retention until', detail.retentionUntil ? formatDateTime(detail.retentionUntil) : '—'],
                  ['PostgreSQL', detail.databaseVersion ?? '—'],
                  ['pg_dump', detail.pgDumpVersion ?? '—'],
                  ['App version', detail.appVersion ?? '—'],
                  ['Environment', detail.environment],
                  ['Attempts', String(detail.attempts)],
                  ['Last verified', detail.lastVerifiedAt ? formatDateTime(detail.lastVerifiedAt) : '—'],
                  ['Error', detail.errorCategory ? `${detail.errorCategory}: ${detail.errorMessage ?? ''}` : '—'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-xs break-all">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {detail && (detail.status === 'verified' || detail.status === 'success') && (
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => onDownload(detail, 'auth')}>
                <Download className="h-4 w-4 mr-1" /> Auth archive
              </Button>
              <Button variant="outline" size="sm" onClick={() => onDownload(detail, 'main')}>
                <Download className="h-4 w-4 mr-1" /> Main archive
              </Button>
              <Button size="sm" onClick={() => onVerify(detail)} disabled={verify.isPending}>
                <ShieldCheck className="h-4 w-4 mr-1" /> Verify
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!verifyResult} onOpenChange={(o) => !o && setVerifyResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{verifyResult?.ok ? 'Backup verified' : 'Verification failed'}</DialogTitle>
            <DialogDescription>{verifyResult ? `${verifyResult.backupId} · ${formatDateTime(verifyResult.verifiedAt)}` : ''}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {verifyResult?.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />}
                <span>
                  {c.name}
                  {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
