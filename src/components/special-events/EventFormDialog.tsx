'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useCreateEvent, useUpdateEvent } from '@/lib/queries';
import { formatDate } from '@/utils/date';
import {
  CreateSpecialEventSchema,
  EVENT_CATEGORY_LABELS,
  EVENT_PRIORITY_LABELS,
  HIJRI_MONTHS,
  addDaysToDateStr,
  estimateGregorianForHijri,
  formatHijriFor,
  lastWeekdayOfHijriMonthIn,
  nthWeekdayOf,
  type CreateSpecialEventInput,
  type SpecialEventView,
} from '@mb/shared';

/**
 * Create / edit an event.
 *
 * The live "Estimated date" preview under the anchor fields computes client-side
 * purely so the admin sees the consequence of picking "1 Shawwal" before saving.
 * It is a PREVIEW — the value actually stored is whatever the server resolves on
 * save. That split matters: this is a PWA, and an old Android WebView with a
 * trimmed ICU can fall back to `islamic-civil` and be a day off, so the client
 * must never be the authority on an event's date.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NTH_LABELS = ['1st', '2nd', '3rd', '4th', '5th'];

export function EventFormDialog({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  event?: SpecialEventView | null;
}) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const createEvent = useCreateEvent(token);
  const updateEvent = useUpdateEvent(token);

  const branchesQ = useBranches(token, { enabled: open });
  const branches = branchesQ.data ?? [];

  const form = useForm<CreateSpecialEventInput>({
    resolver: zodResolver(CreateSpecialEventSchema),
    defaultValues: event
      ? {
          name: event.name,
          description: event.description ?? '',
          category: event.category,
          eventType: event.eventType ?? '',
          calendarSystem: event.calendarSystem,
          eventYear: event.eventYear,
          hijriMonth: event.hijriMonth,
          hijriDay: event.hijriDay,
          gregorianMonth: event.gregorianMonth,
          gregorianDay: event.gregorianDay,
          nthWeekday: event.nthWeekday,
          weekday: event.weekday,
          anchorOffsetDays: event.anchorOffsetDays,
          isRecurring: event.isRecurring,
          confirmedDate: event.confirmedDate,
          durationDays: event.durationDays,
          demandLeadDays: event.demandLeadDays,
          reminderLeadDays: event.reminderLeadDays,
          priority: event.priority,
          appliesToAllBranches: event.appliesToAllBranches,
          branchIds: event.branchIds ?? [],
          color: event.color,
          notes: event.notes ?? '',
        }
      : {
          name: '',
          description: '',
          category: 'company',
          calendarSystem: 'gregorian',
          eventYear: new Date().getFullYear(),
          isRecurring: true,
          anchorOffsetDays: 0,
          durationDays: 1,
          demandLeadDays: 10,
          reminderLeadDays: 14,
          priority: 'normal',
          appliesToAllBranches: true,
          branchIds: [],
        },
  });

  const calendarSystem = form.watch('calendarSystem');
  const eventYear = form.watch('eventYear');
  const hijriMonth = form.watch('hijriMonth');
  const hijriDay = form.watch('hijriDay');
  const gregorianMonth = form.watch('gregorianMonth');
  const gregorianDay = form.watch('gregorianDay');
  const nthWeekday = form.watch('nthWeekday');
  const weekday = form.watch('weekday');
  const anchorOffsetDays = form.watch('anchorOffsetDays') ?? 0;
  const confirmedDate = form.watch('confirmedDate');
  const appliesToAllBranches = form.watch('appliesToAllBranches');
  const branchIds = form.watch('branchIds') ?? [];

  /** Preview only — the server recomputes and stores the authoritative value. */
  const estimatedPreview = useMemo(() => {
    try {
      if (calendarSystem === 'hijri' && hijriMonth && hijriDay && eventYear) {
        return estimateGregorianForHijri(hijriMonth, hijriDay, eventYear);
      }
      if (calendarSystem === 'gregorian' && gregorianMonth && gregorianDay && eventYear) {
        const candidate = `${eventYear}-${String(gregorianMonth).padStart(2, '0')}-${String(gregorianDay).padStart(2, '0')}`;
        const parsed = new Date(`${candidate}T12:00:00.000Z`);
        return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? null : candidate;
      }
      if (calendarSystem === 'gregorian_nth_weekday' && gregorianMonth && nthWeekday && weekday !== null && weekday !== undefined && eventYear) {
        const base = nthWeekdayOf(eventYear, gregorianMonth, nthWeekday, weekday);
        return base && anchorOffsetDays ? addDaysToDateStr(base, anchorOffsetDays) : base;
      }
      if (calendarSystem === 'hijri_last_weekday' && hijriMonth && weekday !== null && weekday !== undefined && eventYear) {
        return lastWeekdayOfHijriMonthIn(hijriMonth, weekday, eventYear)[0] ?? null;
      }
    } catch {
      return null;
    }
    return null;
  }, [calendarSystem, eventYear, hijriMonth, hijriDay, gregorianMonth, gregorianDay, nthWeekday, weekday, anchorOffsetDays]);

  const effectiveDate = confirmedDate ?? estimatedPreview;

  async function onSubmit(data: CreateSpecialEventInput) {
    setSubmitting(true);
    try {
      if (event) {
        await updateEvent.mutateAsync({ id: event.id, ...data });
        toast.success('Event updated');
      } else {
        await createEvent.mutateAsync(data);
        toast.success('Event created — reminders scheduled');
      }
      onOpenChange(false);
      form.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleBranch(branchId: string) {
    const next = branchIds.includes(branchId)
      ? branchIds.filter((id) => id !== branchId)
      : [...branchIds, branchId];
    form.setValue('branchIds', next, { shouldValidate: true });
  }

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* fullscreen on a phone: this is a long multi-section form, and a bottom
          sheet capped at 90dvh would put half of it behind a scroll. */}
      <DialogContent mobile="fullscreen" className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{event ? 'Edit Event' : 'New Special Event'}</DialogTitle>
          <DialogDescription>
            Reminders are scheduled automatically once the date resolves.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Event Name</Label>
              <Input {...form.register('name')} placeholder="Eid-ul-Fitr" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                items={Object.entries(EVENT_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
                value={form.watch('category')}
                onValueChange={(v) => form.setValue('category', v as never, { shouldValidate: true })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EVENT_CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Expected Demand Level</Label>
              <Select
                items={Object.entries(EVENT_PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
                value={form.watch('priority')}
                onValueChange={(v) => form.setValue('priority', v as never, { shouldValidate: true })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EVENT_PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Calendar</Label>
              <Select
                items={[
                  { value: 'gregorian', label: 'Gregorian (fixed date)' },
                  { value: 'hijri', label: 'Hijri (Islamic)' },
                  { value: 'gregorian_nth_weekday', label: 'Nth weekday of a month' },
                  { value: 'hijri_last_weekday', label: 'Last weekday of a Hijri month' },
                ]}
                value={calendarSystem}
                onValueChange={(v) => form.setValue('calendarSystem', v as never, { shouldValidate: true })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gregorian">Gregorian (fixed date)</SelectItem>
                  <SelectItem value="hijri">Hijri (Islamic)</SelectItem>
                  <SelectItem value="gregorian_nth_weekday">Nth weekday of a month</SelectItem>
                  <SelectItem value="hijri_last_weekday">Last weekday of a Hijri month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Year</Label>
              <Input type="number" {...form.register('eventYear', { valueAsNumber: true })} />
              {errors.eventYear && <p className="text-xs text-destructive">{errors.eventYear.message}</p>}
            </div>

            {/* ── Anchor fields, one set per calendar system ─────────────── */}
            {calendarSystem === 'hijri' && (
              <>
                <div className="space-y-1">
                  <Label>Hijri Month</Label>
                  <Select
                    items={HIJRI_MONTHS.map((name, i) => ({ value: String(i + 1), label: name }))}
                    value={hijriMonth ? String(hijriMonth) : null}
                    onValueChange={(v) => form.setValue('hijriMonth', Number(v), { shouldValidate: true })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select month" /></SelectTrigger>
                    <SelectContent>
                      {HIJRI_MONTHS.map((name, i) => (
                        <SelectItem key={name} value={String(i + 1)}>{`${i + 1}. ${name}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.hijriMonth && <p className="text-xs text-destructive">{errors.hijriMonth.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Hijri Day</Label>
                  <Input type="number" min={1} max={30} {...form.register('hijriDay', { valueAsNumber: true })} />
                  {errors.hijriDay && <p className="text-xs text-destructive">{errors.hijriDay.message}</p>}
                </div>
              </>
            )}

            {calendarSystem === 'gregorian' && (
              <>
                <div className="space-y-1">
                  <Label>Month</Label>
                  <Input type="number" min={1} max={12} {...form.register('gregorianMonth', { valueAsNumber: true })} />
                  {errors.gregorianMonth && <p className="text-xs text-destructive">{errors.gregorianMonth.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Day</Label>
                  <Input type="number" min={1} max={31} {...form.register('gregorianDay', { valueAsNumber: true })} />
                  {errors.gregorianDay && <p className="text-xs text-destructive">{errors.gregorianDay.message}</p>}
                </div>
              </>
            )}

            {calendarSystem === 'gregorian_nth_weekday' && (
              <>
                <div className="space-y-1">
                  <Label>Month</Label>
                  <Input type="number" min={1} max={12} {...form.register('gregorianMonth', { valueAsNumber: true })} />
                </div>
                <div className="space-y-1">
                  <Label>Occurrence</Label>
                  <Select
                    items={NTH_LABELS.map((label, i) => ({ value: String(i + 1), label }))}
                    value={nthWeekday ? String(nthWeekday) : null}
                    onValueChange={(v) => form.setValue('nthWeekday', Number(v), { shouldValidate: true })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Which one" /></SelectTrigger>
                    <SelectContent>
                      {NTH_LABELS.map((label, i) => (
                        <SelectItem key={label} value={String(i + 1)}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Weekday</Label>
                  <Select
                    items={WEEKDAYS.map((label, i) => ({ value: String(i), label }))}
                    value={weekday !== null && weekday !== undefined ? String(weekday) : null}
                    onValueChange={(v) => form.setValue('weekday', Number(v), { shouldValidate: true })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select weekday" /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((label, i) => (
                        <SelectItem key={label} value={String(i)}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Shift by (days)</Label>
                  <Input
                    type="number"
                    min={-30}
                    max={30}
                    {...form.register('anchorOffsetDays', { valueAsNumber: true })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Black Friday is the 4th Thursday of November shifted +1; Cyber Monday +4.
                  </p>
                </div>
              </>
            )}

            {calendarSystem === 'hijri_last_weekday' && (
              <>
                <div className="space-y-1">
                  <Label>Hijri Month</Label>
                  <Select
                    items={HIJRI_MONTHS.map((name, i) => ({ value: String(i + 1), label: name }))}
                    value={hijriMonth ? String(hijriMonth) : null}
                    onValueChange={(v) => form.setValue('hijriMonth', Number(v), { shouldValidate: true })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select month" /></SelectTrigger>
                    <SelectContent>
                      {HIJRI_MONTHS.map((name, i) => (
                        <SelectItem key={name} value={String(i + 1)}>{`${i + 1}. ${name}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.hijriMonth && <p className="text-xs text-destructive">{errors.hijriMonth.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Last which weekday</Label>
                  <Select
                    items={WEEKDAYS.map((label, i) => ({ value: String(i), label }))}
                    value={weekday !== null && weekday !== undefined ? String(weekday) : null}
                    onValueChange={(v) => form.setValue('weekday', Number(v), { shouldValidate: true })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select weekday" /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((label, i) => (
                        <SelectItem key={label} value={String(i)}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.weekday && <p className="text-xs text-destructive">{errors.weekday.message}</p>}
                  <p className="text-xs text-muted-foreground">
                    e.g. the last Friday of Ramadan (Jumuat-ul-Wida). The day number moves each
                    year, because the month is 29 or 30 days depending on the year.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* ── Resolved date preview ───────────────────────────────────── */}
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {effectiveDate ? formatDate(effectiveDate) : 'Date cannot be resolved yet'}
            </p>
            {effectiveDate && (
              <p className="text-xs text-muted-foreground">
                {formatHijriFor(effectiveDate)}
                {confirmedDate ? ' · confirmed' : ' · estimated'}
              </p>
            )}
            {calendarSystem === 'hijri' && !confirmedDate && (
              <p className="mt-1 text-xs text-muted-foreground">
                Calculated from the Umm al-Qura calendar. Pakistan announces on moon sighting and
                may differ by a day or two — set a confirmed date once it is announced.
              </p>
            )}
            {!effectiveDate && calendarSystem === 'hijri' && hijriMonth && hijriDay && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                This Hijri date does not fall in {eventYear} — a Hijri year is ~354 days, so some
                anniversaries skip a Gregorian year. Try an adjacent year.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Confirmed Date (optional)</Label>
              <Input
                type="date"
                value={confirmedDate ?? ''}
                onChange={(e) =>
                  form.setValue('confirmedDate', e.target.value || null, { shouldValidate: true })
                }
              />
              <p className="text-xs text-muted-foreground">Overrides the estimate everywhere.</p>
            </div>

            <div className="space-y-1">
              <Label>Duration (days)</Label>
              <Input type="number" min={1} {...form.register('durationDays', { valueAsNumber: true })} />
            </div>

            <div className="space-y-1">
              <Label>First Reminder (days before)</Label>
              <Input type="number" min={1} max={120} {...form.register('reminderLeadDays', { valueAsNumber: true })} />
              <p className="text-xs text-muted-foreground">
                How much warning this event needs. 30 for Eid-ul-Adha, 7 for a minor occasion.
                Production is reminded a week earlier again.
              </p>
              {errors.reminderLeadDays && (
                <p className="text-xs text-destructive">{errors.reminderLeadDays.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Demand Due (days before)</Label>
              <Input type="number" min={0} {...form.register('demandLeadDays', { valueAsNumber: true })} />
              <p className="text-xs text-muted-foreground">
                Branches must submit by this many days before the event.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Event Type</Label>
              <Input {...form.register('eventType')} placeholder="Religious Festival" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>Description</Label>
              <Textarea {...form.register('description')} rows={2} placeholder="Optional planning notes…" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label>Recurs every year</Label>
              <p className="text-xs text-muted-foreground">
                Next year&apos;s occurrence is created automatically from this anchor.
              </p>
            </div>
            <Switch
              checked={form.watch('isRecurring') ?? true}
              onCheckedChange={(v) => form.setValue('isRecurring', v, { shouldValidate: true })}
            />
          </div>

          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Applies to all branches</Label>
                <p className="text-xs text-muted-foreground">
                  Turn off to target specific branches only.
                </p>
              </div>
              <Switch
                checked={appliesToAllBranches ?? true}
                onCheckedChange={(v) => form.setValue('appliesToAllBranches', v, { shouldValidate: true })}
              />
            </div>

            {!appliesToAllBranches && (
              <div className="mt-3 flex flex-wrap gap-2">
                {branches.length === 0 && (
                  <p className="text-xs text-muted-foreground">No branches available.</p>
                )}
                {branches.map((branch) => {
                  const selected = branchIds.includes(branch.id);
                  return (
                    <Button
                      key={branch.id}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      size="sm"
                      className="min-h-11 md:min-h-8"
                      onClick={() => toggleBranch(branch.id)}
                    >
                      {branch.name}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : event ? 'Update Event' : 'Create Event'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
