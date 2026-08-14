'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  businessDateStr,
  CreateEmployeeSchema,
  CreateSalaryPaymentSchema,
  CreateSalaryRevisionSchema,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  type Attachment,
  type CreateEmployeeInput,
  type CreateSalaryPaymentInput,
  type CreateSalaryRevisionInput,
  type FinanceEmployee,
  type SalaryPayment,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceEmployees, useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { cn } from '@/lib/utils';
import { Money } from './finance-ui';

/**
 * The two payroll forms.
 *
 * `finance_employees` is a payroll master separate from `users` — most people on
 * a bakery's payroll have no login and never will, so an employee is created
 * here rather than provisioned as an account.
 */

// ---------------------------------------------------------------------------
// Salary payment
// ---------------------------------------------------------------------------

/** The current month as YYYY-MM, from the business date so the 2 AM rollover applies. */
function currentSalaryMonth(): string {
  return businessDateStr().slice(0, 7);
}

export function SalaryForm({
  salary,
  onSuccess,
}: {
  /** Present when editing a draft or rejected payslip. */
  salary?: SalaryPayment;
  onSuccess?: () => void;
}) {
  const employeesQ = useFinanceEmployees();
  const mut = useFinanceMutation();

  const form = useForm<CreateSalaryPaymentInput>({
    resolver: zodResolver(CreateSalaryPaymentSchema),
    defaultValues: {
      employeeId: salary?.employeeId ?? '',
      salaryMonth: salary?.salaryMonth ?? currentSalaryMonth(),
      grossSalary: (salary?.grossSalary ?? undefined) as unknown as number,
      bonus: salary?.bonus ?? 0,
      deductions: salary?.deductions ?? 0,
      paymentDate: salary?.paymentDate ?? businessDateStr(),
      paymentMethod: (salary?.paymentMethod as CreateSalaryPaymentInput['paymentMethod']) ?? 'cash',
      account: salary?.account ?? 'cash',
      notes: salary?.notes ?? '',
      asDraft: false,
      attachmentIds: (salary?.attachments ?? []).map((a) => a.id),
    },
  });

  const [photos, setPhotos] = useState<Attachment[]>(salary?.attachments ?? []);

  function setPhotoField(next: Attachment[]) {
    setPhotos(next);
    form.setValue(
      'attachmentIds',
      next.map((a) => a.id),
      { shouldValidate: true },
    );
  }

  const employeeId = form.watch('employeeId');
  const account = form.watch('account');
  const paymentMethod = form.watch('paymentMethod');

  // Live net, computed exactly as the server does. An approver sees this figure
  // on the payslip, so the person filling it in should see it too — a deduction
  // that swallows the salary is otherwise only caught at validation.
  const net =
    (Number(form.watch('grossSalary')) || 0) +
    (Number(form.watch('bonus')) || 0) -
    (Number(form.watch('deductions')) || 0);

  const employees = employeesQ.data ?? [];
  const selected = employees.find((e) => e.id === employeeId);

  function pickEmployee(id: string) {
    form.setValue('employeeId', id, { shouldValidate: true });
    // Prefill from the master's base salary — right nearly every month, and
    // still editable for the month it is not.
    const emp = employees.find((e) => e.id === id);
    if (emp && emp.baseSalary > 0 && !form.getValues('grossSalary')) {
      form.setValue('grossSalary', emp.baseSalary, { shouldValidate: true });
    }
  }

  async function save(data: CreateSalaryPaymentInput, asDraft: boolean) {
    try {
      if (salary) {
        // employeeId and salaryMonth are absent from the update schema: changing
        // either would sidestep the one-payslip-per-employee-per-month
        // constraint that stops a double payment.
        await mut.mutateAsync({
          path: `/api/finance/payroll/salaries/${salary.id}`,
          method: 'PUT',
          body: {
            grossSalary: data.grossSalary,
            bonus: data.bonus,
            deductions: data.deductions,
            paymentDate: data.paymentDate,
            paymentMethod: data.paymentMethod,
            account: data.account,
            notes: data.notes,
          },
        });
        toast.success('Payslip updated');
      } else {
        await mut.mutateAsync({ path: '/api/finance/payroll/salaries', body: { ...data, asDraft } });
        toast.success(asDraft ? 'Saved as a draft' : 'Submitted for approval');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this payslip');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((d) => save(d, false))} className="space-y-4">
      <div className="space-y-1">
        <Label>Employee</Label>
        <Select value={employeeId} onValueChange={(v) => pickEmployee((v as string) ?? '')} disabled={Boolean(salary)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={employeesQ.isLoading ? 'Loading…' : 'Select an employee'} />
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name} · {e.designation}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.employeeId && <p className="text-xs text-destructive">{errors.employeeId.message}</p>}
        {selected && (
          <p className="text-xs text-muted-foreground">
            {selected.department} · {selected.designation}
            {selected.branchName ? ` · ${selected.branchName}` : ''}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Salary month</Label>
          <Input type="month" disabled={Boolean(salary)} {...form.register('salaryMonth')} />
          {errors.salaryMonth && <p className="text-xs text-destructive">{errors.salaryMonth.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Payment date</Label>
          <Input type="date" {...form.register('paymentDate')} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Salary</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register('grossSalary', { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-1">
          <Label>Bonus</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register('bonus', { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-1">
          <Label>Deduction</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register('deductions', { valueAsNumber: true })}
          />
        </div>
      </div>
      {errors.grossSalary && <p className="text-xs text-destructive">{errors.grossSalary.message}</p>}
      {errors.deductions && <p className="text-xs text-destructive">{errors.deductions.message}</p>}

      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5">
        <span className="text-sm font-medium">Net salary</span>
        <Money value={net} className="text-lg font-bold" />
      </div>

      <div className="space-y-2">
        <Label>Paid from</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['cash', 'bank'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => form.setValue('account', a)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                account === a ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
              )}
            >
              {FINANCE_ACCOUNT_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Payment method</Label>
        <Select
          value={paymentMethod}
          onValueChange={(v) => form.setValue('paymentMethod', (v as CreateSalaryPaymentInput['paymentMethod']) ?? 'cash')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FINANCE_PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {FINANCE_PAYMENT_METHOD_LABELS[m] ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Notes (optional)</Label>
        <Textarea rows={2} placeholder="e.g. Eid bonus included" {...form.register('notes')} />
      </div>

      {salary ? (
        <div className="space-y-2">
          <Label>Photo</Label>
          <AttachmentGallery
            attachments={photos}
            title={`${salary.salaryNo} payslip`}
            emptyText="No photo was captured with this payslip."
          />
        </div>
      ) : (
        <PhotoCapture
          entity="salary_payment"
          value={photos}
          onChange={setPhotoField}
          label="Payslip photo"
          required
          disabled={mut.isPending}
          hint="Photograph the signed payslip or the cash handover."
          error={errors.attachmentIds?.message}
        />
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!salary && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            disabled={mut.isPending}
            onClick={() => void form.handleSubmit((d) => save(d, true))()}
          >
            Save as draft
          </Button>
        )}
        <Button type="submit" size="lg" className="flex-1" disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : salary ? 'Save changes' : 'Submit for approval'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export function EmployeeForm({
  employee,
  onSuccess,
}: {
  employee?: FinanceEmployee;
  onSuccess?: () => void;
}) {
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');
  const mut = useFinanceMutation();

  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(CreateEmployeeSchema),
    defaultValues: {
      name: employee?.name ?? '',
      department: employee?.department ?? '',
      designation: employee?.designation ?? '',
      branchId: employee?.branchId ?? null,
      baseSalary: employee?.baseSalary ?? 0,
      phone: employee?.phone ?? '',
      joinedOn: employee?.joinedOn ?? null,
    },
  });

  const branchId = form.watch('branchId');

  async function save(data: CreateEmployeeInput) {
    try {
      await mut.mutateAsync({
        path: employee ? `/api/finance/payroll/employees/${employee.id}` : '/api/finance/payroll/employees',
        method: employee ? 'PUT' : 'POST',
        // Editing never carries baseSalary — a raise needs a reason and an
        // effective date, which only the separate Revise Salary flow collects.
        body: employee ? { ...data, baseSalary: undefined } : data,
      });
      toast.success(employee ? 'Employee updated' : 'Employee added');
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this employee');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(save)} className="space-y-4">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input placeholder="Full name" {...form.register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Department</Label>
          <Input placeholder="e.g. Production" {...form.register('department')} />
          {errors.department && <p className="text-xs text-destructive">{errors.department.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Designation</Label>
          <Input placeholder="e.g. Baker" {...form.register('designation')} />
          {errors.designation && <p className="text-xs text-destructive">{errors.designation.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {employee ? (
          <div className="space-y-1">
            <Label>Current salary</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3">
              <Money value={employee.baseSalary} className="text-sm font-medium" />
            </div>
            <p className="text-xs text-muted-foreground">Use Revise Salary to change this.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label>Base salary</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              {...form.register('baseSalary', { valueAsNumber: true })}
            />
            {errors.baseSalary && <p className="text-xs text-destructive">{errors.baseSalary.message}</p>}
          </div>
        )}
        <div className="space-y-1">
          <Label>Joined on</Label>
          <Input type="date" {...form.register('joinedOn')} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Branch (optional)</Label>
        <Select
          value={branchId ?? '__none__'}
          onValueChange={(v) => form.setValue('branchId', v === '__none__' ? null : ((v as string) ?? null))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Head office" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Head office</SelectItem>
            {(branchesQ.data ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Phone (optional)</Label>
        <Input placeholder="03xx xxxxxxx" {...form.register('phone')} />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={mut.isPending}>
        {mut.isPending ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Salary revision
// ---------------------------------------------------------------------------

/**
 * Records a base-salary change with a reason and an effective date — the
 * only way baseSalary can change once an employee exists. Today-or-earlier
 * applies immediately; a future date is simply recorded now and resolved on
 * read once it arrives. Either way, payslips already created are untouched:
 * they snapshot their own gross salary and never re-read the employee master.
 */
export function SalaryRevisionForm({ employee, onSuccess }: { employee: FinanceEmployee; onSuccess?: () => void }) {
  const mut = useFinanceMutation();

  const form = useForm<CreateSalaryRevisionInput>({
    resolver: zodResolver(CreateSalaryRevisionSchema),
    defaultValues: {
      newSalary: employee.baseSalary,
      reason: '',
      effectiveFrom: businessDateStr(),
    },
  });

  async function save(data: CreateSalaryRevisionInput) {
    try {
      await mut.mutateAsync({
        path: `/api/finance/payroll/employees/${employee.id}/salary-revisions`,
        body: data,
      });
      toast.success(
        data.effectiveFrom <= businessDateStr() ? 'Salary updated' : `Salary change scheduled for ${data.effectiveFrom}`,
      );
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record this salary change');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(save)} className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Current salary</p>
        <Money value={employee.baseSalary} className="text-lg font-bold" />
      </div>

      <div className="space-y-1">
        <Label>New salary</Label>
        <Input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
          {...form.register('newSalary', { valueAsNumber: true })}
        />
        {errors.newSalary && <p className="text-xs text-destructive">{errors.newSalary.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Effective from</Label>
        <Input type="date" {...form.register('effectiveFrom')} />
        <p className="text-xs text-muted-foreground">
          Today or an earlier date applies right away. A future date is recorded now and takes effect on its own —
          payslips already created are never affected.
        </p>
      </div>

      <div className="space-y-1">
        <Label>Reason</Label>
        <Textarea rows={2} placeholder="e.g. Annual increment" {...form.register('reason')} />
        {errors.reason && <p className="text-xs text-destructive">{errors.reason.message}</p>}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={mut.isPending}>
        {mut.isPending ? 'Saving…' : 'Save salary change'}
      </Button>
    </form>
  );
}
