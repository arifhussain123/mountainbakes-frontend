'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { User, Branch, UserRole, BranchShift } from '@mb/shared';
import {
  BRANCH_SHIFTS,
  BRANCH_SHIFT_LABELS,
  CreateUserSchema,
  FINANCE_ROLE_LABELS,
  FINANCE_ROLES,
  isBranchRole,
  type CreateUserInput,
} from '@mb/shared';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { EditUserDialog } from './EditUserDialog';
import { UserDetailsDialog } from './UserDetailsDialog';
import { UserActivity } from './UserActivity';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MoreHorizontal, Pencil, KeyRound, Eye, Trash2, UserCheck, UserX } from 'lucide-react';

const col = createColumnHelper<User>();

// The four finance roles share one colour: they are one department to everyone
// looking at this list, and what separates them is what they may DO in the
// Finance Ledger, which no user-management screen shows.
const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-primary/10 text-primary',
  branch_manager: 'bg-secondary/10 text-secondary',
  // A shift account is a lighter shade of the same colour as the manager it sits
  // under — they are the same shop, and the list should read that way.
  branch_user: 'bg-secondary/5 text-secondary',
  production_user: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  finance_admin: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  finance_manager: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  accountant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  finance_auditor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
};

export function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('branch_manager');
  const [submitting, setSubmitting] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'reset' | 'details' | null>(null);

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { email: '', displayName: '', phone: '', username: '', password: '', role: 'branch_manager', branchId: null },
  });

  const [refreshKey, setRefreshKey] = useState(0);
  function load() { setRefreshKey((k) => k + 1); }

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiCall<{ users: User[] }>('/api/users', {}, token),
      apiCall<{ branches: Branch[] }>('/api/branches', {}, token),
    ]).then(([u, b]) => {
      setUsers(u.users ?? []);
      setBranches(b.branches ?? []);
    }).catch((err) => {
      console.error('Failed to load users or branches', err);
      toast.error('Could not load users or branches');
    }).finally(() => setLoading(false));
  }, [token, refreshKey]);

  async function onSubmit(data: CreateUserInput) {
    setSubmitting(true);
    try {
      await apiCall('/api/users', { method: 'POST', body: JSON.stringify(data) }, token);
      toast.success('User created');
      setShowForm(false);
      form.reset();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user');
    } finally { setSubmitting(false); }
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`Deactivate ${name}?`)) return;
    try {
      await apiCall(`/api/users/${id}`, { method: 'DELETE' }, token);
      toast.success(`${name} deactivated`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate user');
    }
  }

  async function handleActivate(id: string, name: string) {
    try {
      await apiCall(`/api/users/${id}/activate`, { method: 'POST' }, token);
      toast.success(`${name} activated`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to activate user');
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? This deactivates the account and revokes access.`)) return;
    try {
      await apiCall(`/api/users/${id}`, { method: 'DELETE' }, token);
      toast.success(`${name} removed`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  const columns = [
    col.accessor('displayName', {
      header: 'User',
      meta: { mobile: 'title' },
      cell: (info) => (
        <div>
          <p className="font-medium">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">{info.row.original.email}</p>
        </div>
      ),
    }),
    col.accessor('username', { header: 'Username', meta: { mobile: 'subtitle' }, cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span> }),
    col.accessor('role', {
      header: 'Role',
      meta: { mobile: 'badge' },
      cell: (info) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_COLORS[info.getValue()]}`}>
          {info.getValue().replace('_', ' ')}
        </span>
      ),
    }),
    col.accessor('branchName', { header: 'Branch', cell: (info) => info.getValue() || <span className="text-muted-foreground">â€”</span> }),
    // Null on every role but branch_user, so this column is mostly dashes — it
    // earns its place because morning and evening accounts on one branch are
    // otherwise indistinguishable in this list.
    col.accessor('shift', {
      header: 'Shift',
      cell: (info) => {
        const shift = info.getValue();
        return shift
          ? <span className="text-sm">{BRANCH_SHIFT_LABELS[shift]}</span>
          : <span className="text-muted-foreground">â€”</span>;
      },
    }),
    col.accessor('phone', { header: 'Phone' }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (info) => (
        <Badge variant={info.getValue() === 'active' ? 'default' : 'secondary'} className="capitalize">
          {info.getValue()}
        </Badge>
      ),
    }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const u = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="User actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setSelectedUser(u); setDialog('edit'); }}>
                <Pencil className="h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSelectedUser(u); setDialog('reset'); }}>
                <KeyRound className="h-4 w-4" /> Reset Password
              </DropdownMenuItem>
              {u.status === 'active' ? (
                <DropdownMenuItem onClick={() => handleDeactivate(u.id, u.displayName)}>
                  <UserX className="h-4 w-4" /> Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => handleActivate(u.id, u.displayName)}>
                  <UserCheck className="h-4 w-4" /> Activate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => { setSelectedUser(u); setDialog('details'); }}>
                <Eye className="h-4 w-4" /> View Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => handleDelete(u.id, u.displayName)}>
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">{users.length} total users</p>
        </div>
        <Button onClick={() => setShowForm(true)}>+ Add User</Button>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Users</TabsTrigger>
          <TabsTrigger value="activity">User Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <DataTable columns={columns} data={users} loading={loading} searchPlaceholder="Search usersâ€¦" />
        </TabsContent>
        <TabsContent value="activity">
          <UserActivity token={token} />
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Full Name</Label>
                <Input {...form.register('displayName')} placeholder="Ahmed Khan" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" {...form.register('email')} placeholder="ahmed@mountainbakes.com" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input {...form.register('phone')} placeholder="03001234567" />
              </div>
              <div className="space-y-1">
                <Label>Username</Label>
                <Input {...form.register('username')} placeholder="gulshan01" />
              </div>
              <div className="space-y-1">
                <Label>Password</Label>
                <Input type="password" {...form.register('password')} placeholder="Min 8 characters" />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select
                  defaultValue="branch_manager"
                  onValueChange={(v) => {
                    const role = v as UserRole;
                    setSelectedRole(role);
                    form.setValue('role', role);
                    if (!isBranchRole(role)) form.setValue('branchId', null);
                    // Only a branch_user may carry a shift — migration 66's check
                    // constraint says so, and the Zod schema refuses the pairing
                    // before it ever reaches Postgres.
                    form.setValue('shift', role === 'branch_user' ? 'morning' : null);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="branch_manager">Branch Manager</SelectItem>
                    {/* The normal way a shift account is opened is the Account
                        Requests queue, where a manager asks for one. This option
                        is the direct path, for an admin setting a branch up
                        before there is a manager to ask. */}
                    <SelectItem value="branch_user">Branch User (shift)</SelectItem>
                    <SelectItem value="production_user">Production User</SelectItem>
                    {/* Finance Ledger accounts are provisioned here like every
                        other account — the role rides in app_metadata and is what
                        the module's own login checks. Without these four options
                        there is no way to create a finance user at all. */}
                    {FINANCE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {FINANCE_ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isBranchRole(selectedRole) && (
                <div className="space-y-1">
                  <Label>Branch</Label>
                  <Select
                    items={branches.map((b) => ({ value: b.id, label: b.name }))}
                    value={form.watch('branchId') || null}
                    onValueChange={(v) => form.setValue('branchId', (v as string) ?? null)}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedRole === 'branch_user' && (
                <div className="space-y-1">
                  <Label>Shift</Label>
                  <Select
                    value={form.watch('shift') ?? 'morning'}
                    onValueChange={(v) => form.setValue('shift', (v as BranchShift) ?? 'morning')}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BRANCH_SHIFTS.map((s) => (
                        <SelectItem key={s} value={s}>{BRANCH_SHIFT_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A label only — it does not restrict when the account can sign in.
                  </p>
                </div>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Creatingâ€¦' : 'Create User'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ResetPasswordDialog
        key={`reset-${selectedUser?.id ?? 'none'}-${dialog === 'reset'}`}
        user={selectedUser}
        open={dialog === 'reset'}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
        token={token}
        onDone={load}
      />
      <EditUserDialog
        key={`edit-${selectedUser?.id ?? 'none'}-${dialog === 'edit'}`}
        user={selectedUser}
        branches={branches}
        open={dialog === 'edit'}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
        token={token}
        onDone={load}
      />
      <UserDetailsDialog
        user={selectedUser}
        open={dialog === 'details'}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
      />
    </div>
  );
}
