'use client';

import { useState } from 'react';
import { apiCall } from '@/utils/api';
import type { User, Branch, UserRole, UserStatus } from '@mb/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const ROLE_ITEMS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'branch_manager', label: 'Branch Manager' },
  { value: 'production_user', label: 'Production User' },
];
const STATUS_ITEMS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

export function EditUserDialog({
  user,
  branches,
  open,
  onOpenChange,
  token,
  onDone,
}: {
  user: User | null;
  branches: Branch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onDone: () => void;
}) {
  // Initialised from `user`; the parent remounts this dialog (via key) whenever a
  // different user is selected, so these initial values stay in sync.
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'branch_manager');
  const [branchId, setBranchId] = useState<string | null>(user?.branchId ?? null);
  const [status, setStatus] = useState<UserStatus>(user?.status ?? 'active');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  async function handleSave() {
    if (!user) return;
    setSubmitting(true);
    try {
      await apiCall(
        `/api/users/${user.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            displayName,
            phone,
            role,
            branchId: role === 'branch_manager' ? branchId : null,
            status,
          }),
        },
        token
      );
      toast.success('User updated');
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>Full Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select items={STATUS_ITEMS} value={status} onValueChange={(v) => setStatus(v as UserStatus)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_ITEMS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select
              items={ROLE_ITEMS}
              value={role}
              onValueChange={(v) => {
                const r = v as UserRole;
                setRole(r);
                if (r !== 'branch_manager') setBranchId(null);
              }}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_ITEMS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {role === 'branch_manager' && (
            <div className="space-y-1">
              <Label>Branch</Label>
              <Select
                items={branches.map((b) => ({ value: b.id, label: b.name }))}
                value={branchId || null}
                onValueChange={(v) => setBranchId((v as string) ?? null)}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
