import type { BackupHealthStatus, BackupStatus, BackupType } from '@mb/shared';

/**
 * How the Database Backup screen describes a run — shared by the cards and
 * the history table so one backup never reads differently in two places.
 */

export const STATUS_LABELS: Record<BackupStatus, string> = {
  running: 'Running',
  success: 'Uploaded',
  verified: 'Verified',
  failed: 'Failed',
  stale: 'Interrupted',
};

/** Only `verified` is green: an upload nobody has read back is not yet a backup. */
export const STATUS_STYLES: Record<BackupStatus, string> = {
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  success: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  stale: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

export const HEALTH_LABELS: Record<BackupHealthStatus, string> = {
  healthy: 'Healthy',
  overdue: 'Overdue',
  failed: 'Last run failed',
  never: 'No backup yet',
};

export const HEALTH_STYLES: Record<BackupHealthStatus, string> = {
  healthy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  overdue: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  never: 'bg-muted text-muted-foreground',
};

export const TYPE_LABELS: Record<BackupType, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  manual: 'Manual',
};

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** First 12 hex characters — enough to compare by eye; the full hash is on the detail view. */
export function shortChecksum(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 12)}…` : '—';
}

/** 'database-backups/daily/2026/09/mountainbakes-daily-2026-09-21.dump' → the file name. */
export function keyFileName(key: string | null | undefined): string {
  return key ? key.split('/').pop() ?? key : '—';
}
