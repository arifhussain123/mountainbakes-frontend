import { Skeleton } from '@/components/ui/skeleton';

export function ChatListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

export function ChatMessagesSkeleton() {
  return (
    <div className="flex-1 flex flex-col gap-4 p-4">
      {[false, true, false, false, true, false].map((right, i) => (
        <div key={i} className={`flex items-end gap-2 ${right ? 'flex-row-reverse' : ''}`}>
          {!right && <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />}
          <div className={`space-y-1 max-w-[65%] ${right ? 'items-end' : 'items-start'} flex flex-col`}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className={`h-12 ${right ? 'w-48' : 'w-64'} rounded-2xl`} />
          </div>
        </div>
      ))}
    </div>
  );
}
