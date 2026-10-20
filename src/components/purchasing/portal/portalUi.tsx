'use client';

import Image from 'next/image';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { IMAGES } from '@/utils/images';
import { COMPANY_NAME } from '@/utils/constants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The supplier portal's building blocks. Its own small set rather than the
 * dashboard's: this page is read on a supplier's phone, once, by someone who
 * has never seen the app — so larger type, larger touch targets and plain
 * sentences, with the same brand colours and logo the sign-in page uses.
 */

export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/30 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b bg-card">
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/70 to-primary/30" />
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary shadow">
            <Image
              src={IMAGES.logo}
              alt={`${COMPANY_NAME} logo`}
              width={44}
              height={44}
              className="size-full object-contain"
              priority
              unoptimized
            />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-foreground">{COMPANY_NAME}</p>
            <p className="text-xs text-muted-foreground">Supplier portal</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-4">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pt-2 text-center text-xs text-muted-foreground">
        This page is only for the order in your WhatsApp message. Do not share the link.
      </footer>
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border bg-card p-4 shadow-sm', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const TONES = {
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100' },
  warning: { icon: TriangleAlert, cls: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100' },
  error: { icon: AlertCircle, cls: 'border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100' },
  success: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' },
} as const;

export function Notice({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, cls } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border p-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

/**
 * A figure input. Text with a decimal keypad rather than type="number": a
 * number input silently empties itself on a comma or a second dot on some
 * phones, which reads as the app losing what was typed.
 */
export function FigureInput({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  suffix,
  placeholder,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  suffix?: string;
  placeholder?: string;
  className?: string;
}) {
  const errId = `${id}-error`;
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {suffix && <span className="font-normal"> ({suffix})</span>}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className="h-11 text-base tabular-nums"
      />
      <FieldError id={errId} message={error} />
    </div>
  );
}

/**
 * A native dropdown, styled like the app's inputs. Native on purpose: on a
 * phone it opens the system picker, which every supplier already knows how to
 * use, and it never needs a popup positioned over a soft keyboard.
 */
export function NativeSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      className="h-11 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** One label / value line of a totals block. */
export function TotalRow({
  label,
  value,
  strong,
  muted,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-0.5', strong && 'border-t pt-2 text-base font-semibold', muted && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
