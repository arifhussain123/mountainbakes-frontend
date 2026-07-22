'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Paperclip, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useCreateTicket, useTicketCategories } from '@/lib/queries';
import { CreateTicketSchema, type CreateTicketInput, TICKET_PRIORITIES } from '@mb/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRIORITY_LABEL } from './ticketMeta';

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.xls,.xlsx,.doc,.docx';

export function NewTicketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { token } = useAuth();
  const categoriesQ = useTicketCategories(token);
  const categories = categoriesQ.data ?? [];
  const createMut = useCreateTicket(token);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateTicketInput>({
    resolver: zodResolver(CreateTicketSchema),
    defaultValues: { subject: '', categoryId: '', description: '', priority: 'medium' },
  });

  async function onSubmit(data: CreateTicketInput) {
    setSubmitting(true);
    try {
      const res = await createMut.mutateAsync(data);

      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await apiCall(`/api/support-tickets/${res.id}/attachments`, { method: 'POST', body: fd }, token);
      }

      toast.success('Ticket created', { description: `Ticket Number: ${res.ticketNo}` });
      form.reset();
      setFile(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label>Subject</Label>
            <Input {...form.register('subject')} placeholder="Brief summary of the issue" />
            {form.formState.errors.subject && <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={form.watch('categoryId') || null}
                onValueChange={(v) => form.setValue('categoryId', (v as string) ?? '', { shouldValidate: true })}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categoriesQ.isLoading ? (
                    <SelectItem value="__loading" disabled>Loading…</SelectItem>
                  ) : (
                    categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
              {form.formState.errors.categoryId && <p className="text-xs text-destructive">{form.formState.errors.categoryId.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Priority</Label>
              <Select
                value={form.watch('priority') || 'medium'}
                onValueChange={(v) => form.setValue('priority', (v as CreateTicketInput['priority']) ?? 'medium', { shouldValidate: true })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea {...form.register('description')} placeholder="Describe the issue in detail…" className="min-h-[100px]" />
            {form.formState.errors.description && <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Attachment (optional)</Label>
            {file ? (
              <div className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-destructive"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent">
                <Paperclip className="h-4 w-4" />
                <span>Attach an image, PDF, Excel or Word file</span>
                <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
