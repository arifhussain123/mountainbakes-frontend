import { cn } from '@/lib/utils';
import type { PresenceStatus } from '@mb/shared';

interface Props {
  status: PresenceStatus;
  className?: string;
  size?: 'sm' | 'md';
}

const COLOR: Record<PresenceStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-amber-400',
  offline: 'bg-muted-foreground/40',
};

export function PresenceDot({ status, className, size = 'sm' }: Props) {
  return (
    <span
      className={cn(
        'rounded-full border-2 border-background flex-shrink-0',
        size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
        COLOR[status],
        className
      )}
      title={status}
    />
  );
}
