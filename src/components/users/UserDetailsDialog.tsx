'use client';

import type { User } from '@mb/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function UserDetailsDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!user) return null;

  const rows: Array<[string, string]> = [
    ['Email', user.email],
    ['Username', user.username],
    ['Phone', user.phone],
    ['Role', user.role.replace('_', ' ')],
    ['Branch', user.branchName || '—'],
    ['Created', fmt(user.createdAt)],
    ['Last login', fmt(user.lastLoginAt)],
    ['Last password reset', fmt(user.lastPasswordReset)],
    ['Reset by', user.passwordResetByName || '—'],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>User details</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{user.displayName}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Badge variant={user.status === 'active' ? 'default' : 'secondary'} className="capitalize">
            {user.status}
          </Badge>
        </div>

        <dl className="divide-y divide-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className={`text-right font-medium ${k === 'Role' ? 'capitalize' : ''}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
