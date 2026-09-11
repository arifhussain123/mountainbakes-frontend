'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Free text in a table cell: one clipped line, expanded to the whole thing on
 * click.
 *
 * The problem this solves is the column, not the cell. A `reason` is typed by a
 * person and has no length limit worth relying on, and a table column is sized
 * by its widest cell — so one long reason stretches that column and squeezes
 * every other column on the row. Clipping alone would hide information the
 * screen exists to show, hence click-to-expand: compressed by default,
 * complete on demand.
 *
 * `max-w` is load-bearing, not decoration. `truncate` is overflow + ellipsis +
 * nowrap, all of which need a bounded width to do anything; without the cap the
 * cell simply grows to fit the text and nothing is ever clipped.
 */

/**
 * Below this, expanding cannot reveal anything — the text already fits the
 * collapsed width at any normal font size, so a control that does nothing
 * visible would just look broken.
 *
 * Deliberately a character count rather than a measured overflow: measuring
 * means writing layout state from an effect, and `react-hooks/set-state-in-effect`
 * is an error in this project. The cost of the approximation is that a handful
 * of borderline strings render as plain text with a hidden ellipsis instead of
 * as a button — invisible, and cheaper than the alternative.
 */
const EXPANDABLE_FROM = 32;

export interface ExpandableTextProps {
  /** The full text. Empty / null renders the placeholder instead. */
  text: string | null | undefined;
  /** Shown when there is no text at all. */
  placeholder?: string;
  className?: string;
}

export function ExpandableText({ text, placeholder = '—', className }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);

  const value = (text ?? '').trim();
  if (!value) {
    return <span className={cn('text-muted-foreground/50', className)}>{placeholder}</span>;
  }

  if (value.length <= EXPANDABLE_FROM) {
    return <span className={className}>{value}</span>;
  }

  return (
    <button
      type="button"
      // stopPropagation because these cells sit in table rows that may later
      // gain a row-level click; reading a reason should never also open a
      // record. Nothing passes onRowClick today — this keeps it that way by
      // construction rather than by memory.
      onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
      // The full text on hover while collapsed, so a mouse user often does not
      // need the click at all. Dropped when expanded — a tooltip repeating
      // what is already on screen is noise.
      title={expanded ? undefined : value}
      aria-expanded={expanded}
      className={cn(
        'block cursor-pointer text-left underline-offset-2 hover:underline',
        expanded ? 'max-w-[28rem] whitespace-pre-wrap break-words' : 'max-w-[12rem] truncate',
        className,
      )}
    >
      {value}
    </button>
  );
}
