'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Search, X, Loader2, Users } from '@/utils/icons';
import { cn } from '@/lib/utils';
import { initials } from '@/utils/helpers';
import { formatRole } from '@/utils/format';
import { db } from '@/utils/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useChats } from '@/hooks/useChats';
import type { ChatMember, GroupChatType } from '@mb/shared';
import { toast } from 'sonner';

interface FirestoreUser {
  uid: string;
  displayName: string;
  role: string;
  branchName: string | null;
}

const GROUP_TYPES: { value: GroupChatType; label: string; description: string }[] = [
  { value: 'admin_only', label: 'Admin Only', description: 'Super admins only' },
  { value: 'production_team', label: 'Production Team', description: 'All production staff' },
  { value: 'all_branch_managers', label: 'Branch Managers', description: 'All branch managers' },
  { value: 'custom', label: 'Custom', description: 'Manually selected members' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  currentUid: string;
  onChatCreated: (chatId: string) => void;
}

export function NewChatDialog({ open, onClose, currentUid, onChatCreated }: Props) {
  const { user } = useAuth();
  const { createDM, createGroup } = useChats();

  const [tab, setTab] = useState<'dm' | 'group'>('dm');
  const [search, setSearch] = useState('');
  const [allUsers, setAllUsers] = useState<FirestoreUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [creating, setCreating] = useState(false);

  // DM state
  const [selectedDMUser, setSelectedDMUser] = useState<FirestoreUser | null>(null);

  // Group state
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupType, setGroupType] = useState<GroupChatType>('custom');
  const [selectedMembers, setSelectedMembers] = useState<FirestoreUser[]>([]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedDMUser(null);
    setGroupName('');
    setGroupDesc('');
    setGroupType('custom');
    setSelectedMembers([]);
  }, [open]);

  const fetchUsers = useCallback(async () => {
    if (!user) return;
    setLoadingUsers(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('displayName')));
      const users: FirestoreUser[] = [];
      snap.forEach((doc) => {
        const d = doc.data();
        const uid = d.uid ?? doc.id;
        if (uid !== currentUid) {
          users.push({ uid, displayName: d.displayName ?? doc.id, role: d.role, branchName: d.branchName ?? null });
        }
      });
      // Role-based DM filter
      const myRole = user.role;
      const filtered = myRole === 'super_admin'
        ? users
        : myRole === 'branch_manager'
          ? users.filter((u) => ['super_admin', 'branch_manager', 'production_user'].includes(u.role))
          : users.filter((u) => ['super_admin', 'branch_manager'].includes(u.role));
      setAllUsers(filtered);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }, [user, currentUid]);

  useEffect(() => {
    if (open) fetchUsers();
  }, [open, fetchUsers]);

  const filteredUsers = allUsers.filter((u) =>
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  function toggleMember(u: FirestoreUser) {
    setSelectedMembers((prev) =>
      prev.some((m) => m.uid === u.uid)
        ? prev.filter((m) => m.uid !== u.uid)
        : [...prev, u]
    );
  }

  async function handleCreateDM() {
    if (!selectedDMUser || !user) return;
    setCreating(true);
    try {
      const member: ChatMember = {
        uid: selectedDMUser.uid,
        displayName: selectedDMUser.displayName,
        role: selectedDMUser.role as ChatMember['role'],
        branchName: selectedDMUser.branchName,
      };
      const chatId = await createDM(member);
      onChatCreated(chatId);
    } catch {
      toast.error('Failed to create conversation');
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateGroup() {
    if (!groupName.trim() || selectedMembers.length === 0 || !user) return;
    setCreating(true);
    try {
      const memberDetails: Record<string, ChatMember> = {};
      selectedMembers.forEach((m) => {
        memberDetails[m.uid] = { uid: m.uid, displayName: m.displayName, role: m.role as ChatMember['role'], branchName: m.branchName };
      });
      const chatId = await createGroup({
        name: groupName.trim(),
        description: groupDesc.trim() || undefined,
        memberUids: selectedMembers.map((m) => m.uid),
        memberDetails,
        groupType,
      });
      onChatCreated(chatId);
    } catch {
      toast.error('Failed to create group');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'dm' | 'group')}>
          <TabsList className="w-full">
            <TabsTrigger value="dm" className="flex-1">Direct Message</TabsTrigger>
            <TabsTrigger value="group" className="flex-1">Group Chat</TabsTrigger>
          </TabsList>

          {/* DM Tab */}
          <TabsContent value="dm" className="mt-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users…"
                className="pl-8 h-9 text-sm"
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1">
              {loadingUsers ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : filteredUsers.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No users found</p>
              ) : filteredUsers.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => setSelectedDMUser(selectedDMUser?.uid === u.uid ? null : u)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors',
                    selectedDMUser?.uid === u.uid ? 'bg-primary/10' : 'hover:bg-muted/60'
                  )}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-muted text-muted-foreground">{initials(u.displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.displayName}</p>
                    <p className="text-[11px] text-muted-foreground">{formatRole(u.role)} {u.branchName ? `· ${u.branchName}` : ''}</p>
                  </div>
                </button>
              ))}
            </div>

            <Button
              className="w-full"
              disabled={!selectedDMUser || creating}
              onClick={handleCreateDM}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {selectedDMUser ? `Message ${selectedDMUser.displayName}` : 'Select a person'}
            </Button>
          </TabsContent>

          {/* Group Tab */}
          <TabsContent value="group" className="mt-3 space-y-3">
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name *"
              className="h-9 text-sm"
            />
            <Textarea
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="Description (optional)"
              className="h-16 text-sm resize-none"
            />

            {/* Group type */}
            <div className="grid grid-cols-2 gap-1.5">
              {GROUP_TYPES.map((gt) => (
                <button
                  key={gt.value}
                  type="button"
                  onClick={() => setGroupType(gt.value)}
                  className={cn(
                    'flex flex-col items-start px-2.5 py-2 rounded-lg border text-left transition-colors text-xs',
                    groupType === gt.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  )}
                >
                  <span className="font-medium">{gt.label}</span>
                  <span className="text-muted-foreground">{gt.description}</span>
                </button>
              ))}
            </div>

            {/* Member search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Add members…"
                className="pl-8 h-9 text-sm"
              />
            </div>

            {/* Selected members */}
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedMembers.map((m) => (
                  <Badge key={m.uid} variant="secondary" className="gap-1 pr-1">
                    {m.displayName}
                    <button type="button" onClick={() => toggleMember(m)}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="max-h-40 overflow-y-auto space-y-0.5 -mx-1">
              {loadingUsers ? (
                <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : filteredUsers.map((u) => {
                const isSelected = selectedMembers.some((m) => m.uid === u.uid);
                return (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => toggleMember(u)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left transition-colors text-sm',
                      isSelected ? 'bg-primary/10' : 'hover:bg-muted/60'
                    )}
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[9px]">{initials(u.displayName)}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate">{u.displayName}</span>
                    <span className="text-[10px] text-muted-foreground">{formatRole(u.role)}</span>
                  </button>
                );
              })}
            </div>

            <Button
              className="w-full"
              disabled={!groupName.trim() || selectedMembers.length === 0 || creating}
              onClick={handleCreateGroup}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Users className="h-4 w-4 mr-2" />}
              Create Group ({selectedMembers.length} members)
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
