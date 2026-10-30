'use client';

import { useRef, useState } from 'react';
import { AI_CAPTURE_MAX_PHOTOS } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Camera, CheckCircle2, ImageUp, Loader2, Maximize2, RefreshCw, TriangleAlert, X } from 'lucide-react';

/** One receipt photo on the page, from the moment it is picked until it is saved on an entry. */
export interface ReceiptPhoto {
  localId: string;
  /** An object URL of the compressed image, for the thumbnail and preview. */
  previewUrl: string | null;
  status: 'processing' | 'uploading' | 'ready' | 'error';
  /** 0–1 while uploading. */
  progress: number;
  /** The staged attachment id once uploaded. */
  attachmentId: string | null;
  error: string | null;
  /** Read by the AI in an earlier run (so Generate does not send it again). */
  analyzed: boolean;
  /** What the AI said of it: false when nothing could be read. */
  readable: boolean | null;
  note: string | null;
  /** On a saved entry: it can no longer be removed here. */
  saved: boolean;
}

/**
 * The receipts half of AI Expense Capture: Take Photo (the phone's camera
 * app), Upload (several at once), or drag and drop on a desktop; thumbnails
 * with their upload progress, and remove, replace or open full size.
 *
 * It only reports what was picked. Compressing and uploading is the page's
 * job (AiExpenseCapturePage), which owns the photos.
 */
export function ReceiptUploader({
  photos,
  onAdd,
  onRemove,
  onReplace,
  onRetry,
  onPreview,
  disabled,
}: {
  photos: ReceiptPhoto[];
  onAdd: (files: File[]) => void;
  onRemove: (localId: string) => void;
  onReplace: (localId: string, file: File) => void;
  onRetry: (localId: string) => void;
  onPreview: (localId: string) => void;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const room = AI_CAPTURE_MAX_PHOTOS - photos.filter((p) => !p.saved).length;

  function take(list: FileList | null) {
    if (!list || list.length === 0) return;
    onAdd(Array.from(list));
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-4 text-center transition-colors sm:p-6',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-center">
          <Button type="button" size="lg" className="h-12" disabled={disabled || room <= 0} onClick={() => cameraRef.current?.click()}>
            <Camera className="size-5" /> Take Photo
          </Button>
          <Button type="button" size="lg" variant="outline" className="h-12" disabled={disabled || room <= 0} onClick={() => filesRef.current?.click()}>
            <ImageUp className="size-5" /> Upload Receipt
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Or drop photos here. </span>
          JPG, PNG or WebP · up to {AI_CAPTURE_MAX_PHOTOS} at a time · one receipt per photo works best, but a long bill over several photos is fine.
        </p>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={filesRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={replaceRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && replacing) onReplace(replacing, file);
            setReplacing(null);
            e.target.value = '';
          }}
        />
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.localId} className="relative overflow-hidden rounded-lg border bg-muted/40">
              <button
                type="button"
                className="block aspect-[3/4] w-full"
                onClick={() => p.previewUrl && onPreview(p.localId)}
                aria-label={`Receipt ${i + 1}: open full size`}
              >
                {p.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL; next/image cannot optimise it
                  <img src={p.previewUrl} alt={`Receipt ${i + 1}`} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                  </span>
                )}
              </button>
              <span className="absolute left-1 top-1 rounded bg-background/90 px-1.5 text-[11px] font-medium tabular-nums">{i + 1}</span>
              {!p.saved && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(p.localId)}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1 hover:bg-background"
                  aria-label={`Remove receipt ${i + 1}`}
                >
                  <X className="size-3.5" />
                </button>
              )}
              <div className="absolute inset-x-0 bottom-0 space-y-1 bg-background/90 px-1.5 py-1 text-[11px]">
                {p.status === 'processing' && <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Preparing…</span>}
                {p.status === 'uploading' && (
                  <>
                    <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Uploading</span>
                    <Progress value={Math.round(p.progress * 100)} className="h-1" />
                  </>
                )}
                {p.status === 'error' && (
                  <span className="flex items-center justify-between gap-1 text-destructive">
                    <span className="flex min-w-0 items-center gap-1"><TriangleAlert className="size-3 shrink-0" /><span className="truncate" title={p.error ?? ''}>{p.error}</span></span>
                    {p.previewUrl && (
                      <button type="button" onClick={() => onRetry(p.localId)} aria-label="Retry upload"><RefreshCw className="size-3" /></button>
                    )}
                  </span>
                )}
                {p.status === 'ready' && (
                  <span className="flex items-center justify-between gap-1">
                    {p.saved ? (
                      <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Saved</span>
                    ) : p.readable === false ? (
                      <span className="flex min-w-0 items-center gap-1 text-amber-700 dark:text-amber-400" title={p.note ?? ''}>
                        <TriangleAlert className="size-3 shrink-0" /><span className="truncate">{p.note ?? 'Not readable'}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{p.analyzed ? 'Read' : 'Ready'}</span>
                    )}
                    <span className="flex items-center gap-1.5">
                      {!p.saved && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => { setReplacing(p.localId); replaceRef.current?.click(); }}
                          aria-label={`Replace receipt ${i + 1}`}
                          title="Replace"
                        >
                          <RefreshCw className="size-3" />
                        </button>
                      )}
                      <button type="button" onClick={() => onPreview(p.localId)} aria-label={`Open receipt ${i + 1}`} title="Full size">
                        <Maximize2 className="size-3" />
                      </button>
                    </span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
