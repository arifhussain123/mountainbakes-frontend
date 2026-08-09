'use client';

import { useEffect, useState } from 'react';
import { apiCall } from '@/utils/api';
import type { AuditLog } from '@mb/shared';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const ACTION_LABELS: Record<string, string> = {
  password_reset: 'Reset Password',
  password_changed: 'Changed Password',
  user_created: 'Created User',
  user_updated: 'Updated User',
  user_activated: 'Activated User',
  user_deactivated: 'Deactivated User',
  branch_location_updated: 'Updated Branch Location',
  branch_location_removed: 'Removed Branch Location',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UserActivity({ token }: { token: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    apiCall<{ logs: AuditLog[] }>('/api/users/activity', {}, token)
      .then((r) => setLogs(r.logs ?? []))
      .catch((err) => {
        console.error('Failed to load activity', err);
        toast.error('Could not load activity');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (logs.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="rounded-lg border p-3 text-sm">
          <p className="text-xs text-muted-foreground">{formatWhen(log.createdAt)}</p>
          <div className="mt-1 grid gap-0.5">
            <p>
              <span className="text-muted-foreground">Admin:</span> {log.adminName}
            </p>
            <p>
              <span className="text-muted-foreground">Action:</span>{' '}
              <span className="font-medium">{ACTION_LABELS[log.action] ?? log.action}</span>
            </p>
            {log.targetUserName && (
              <p>
                <span className="text-muted-foreground">User:</span> {log.targetUserName}
                {log.targetUserRole ? (
                  <span className="capitalize"> ({log.targetUserRole.replace('_', ' ')})</span>
                ) : null}
              </p>
            )}
            {log.details && <p className="text-xs text-muted-foreground">{log.details}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
