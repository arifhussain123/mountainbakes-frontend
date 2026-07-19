import Image from 'next/image';
import { FileText, X } from '@/utils/icons';
import { Button } from '@/components/ui/button';
import type { ChatAttachment } from '@mb/shared';
import { cn } from '@/lib/utils';

interface StagedFile {
  file: File;
  preview: string;
  uploading: boolean;
  result?: ChatAttachment;
}

interface BubbleProps {
  mode: 'bubble';
  attachment: ChatAttachment;
}

interface SendProps {
  mode: 'send';
  staged: StagedFile;
  onRemove: () => void;
}

type Props = BubbleProps | SendProps;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPreview(props: Props) {
  if (props.mode === 'bubble') {
    const { attachment } = props;
    const isImage = attachment.mimeType.startsWith('image/');

    if (isImage) {
      return (
        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
          <Image
            src={attachment.url}
            alt={attachment.name}
            width={240}
            height={160}
            className="rounded-lg object-cover max-h-48 w-auto"
            unoptimized
          />
        </a>
      );
    }

    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors max-w-[220px]"
      >
        <FileText className="h-5 w-5 text-primary flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{attachment.name}</p>
          <p className="text-[10px] text-muted-foreground">{formatBytes(attachment.size)}</p>
        </div>
      </a>
    );
  }

  // Send mode — staged file preview
  const { staged, onRemove } = props;
  const isImage = staged.file.type.startsWith('image/');

  return (
    <div className="relative inline-flex">
      {isImage ? (
        <Image
          src={staged.preview}
          alt={staged.file.name}
          width={64}
          height={64}
          className={cn('h-16 w-16 rounded-lg object-cover', staged.uploading && 'opacity-50')}
        />
      ) : (
        <div className="flex items-center gap-2 bg-muted rounded-lg px-2.5 py-2 h-16 max-w-[180px]">
          <FileText className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{staged.file.name}</p>
            <p className="text-[10px] text-muted-foreground">{formatBytes(staged.file.size)}</p>
          </div>
        </div>
      )}

      {!staged.uploading && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}

      {staged.uploading && (
        <div className="absolute inset-0 rounded-lg bg-black/30 flex items-center justify-center">
          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
