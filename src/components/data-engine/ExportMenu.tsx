'use client';

/**
 * Data Engine — Export menu.
 *
 *   Export current page   (.xlsx)
 *   Export all results    (.xlsx)
 *   ─────
 *   CSV — current page / all results
 *
 * Both scopes send the list's own query string, so the sheet holds exactly the
 * rows the table shows (or would show across every page). The server builds
 * the file and refuses an "all" export past its row ceiling with a message
 * that names the ceiling, which is surfaced as-is.
 */
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FilterValue, ListQueryState } from '@mb/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { exportResource, type ExportFormat, type ExportScope } from '@/lib/data-engine/useResource';
import { cn } from '@/lib/utils';

export interface ExportMenuProps {
  resource: string;
  state: ListQueryState;
  fixedFilters?: FilterValue[];
  /** Rows on the current page — disables "current page" when there are none. */
  pageCount?: number;
  total?: number;
  fileName?: string;
  className?: string;
}

export function ExportMenu({ resource, state, fixedFilters, pageCount, total, fileName, className }: ExportMenuProps) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);

  async function run(scope: ExportScope, format: ExportFormat) {
    if (!token || busy) return;
    setBusy(true);
    try {
      await exportResource(resource, state, token, { scope, format, fixedFilters, fileName });
      toast.success(`${format === 'csv' ? 'CSV' : 'Excel'} exported`);
    } catch (err) {
      // The API's message is the useful one ("would exceed 10,000 rows…").
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  const none = (pageCount ?? 0) === 0 && (total ?? 0) === 0;
  const allLabel = total !== undefined ? `Export all ${total.toLocaleString()} results` : 'Export all results';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className={cn('h-11 md:h-9', className)} disabled={busy || none} />}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin md:mr-1.5" /> : <Download className="h-3.5 w-3.5 md:mr-1.5" />}
        <span className="ml-1.5 md:ml-0">Export</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Excel</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => run('page', 'excel')} disabled={(pageCount ?? 1) === 0}>
          Export current page
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('all', 'excel')}>{allLabel}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>CSV</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => run('page', 'csv')} disabled={(pageCount ?? 1) === 0}>
          Current page as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('all', 'csv')}>All results as CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
