'use client';

import { passwordChecks, passwordScore } from '@/utils/password';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';

const LABELS = ['Very weak', 'Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
const BAR_COLOR = [
  'bg-destructive',
  'bg-destructive',
  'bg-amber-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-emerald-500',
];

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordScore(password); // 0..5
  const checks = passwordChecks(password);

  return (
    <div className="space-y-2">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i < score ? BAR_COLOR[score] : 'bg-muted'
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Strength: <span className="font-medium text-foreground">{LABELS[score]}</span>
      </p>
      <ul className="grid grid-cols-1 gap-1">
        {checks.map((c) => (
          <li
            key={c.label}
            className={cn(
              'flex items-center gap-1.5 text-xs',
              c.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
            )}
          >
            {c.passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
