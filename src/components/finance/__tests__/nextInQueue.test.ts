import { describe, expect, it } from 'vitest';
import type { FinanceTransaction } from '@mb/shared';
import { nextInQueue, queueOf } from '../FinanceEntryDetails';

const row = (id: string, status: FinanceTransaction['status']) => ({ id, status }) as FinanceTransaction;

describe('nextInQueue', () => {
  const rows = [row('a', 'draft'), row('b', 'posted'), row('c', 'draft'), row('d', 'pending_approval'), row('e', 'draft')];

  it('opens the next draft below the one just submitted, skipping other statuses', () => {
    expect(nextInQueue(rows, 'a', 'draft')?.id).toBe('c');
    expect(nextInQueue(rows, 'c', 'draft')?.id).toBe('e');
  });

  it('wraps round to the top of the page', () => {
    expect(nextInQueue(rows, 'e', 'draft')?.id).toBe('a');
  });

  it('works through the approval queue the same way', () => {
    const queue = [row('p1', 'pending_approval'), row('x', 'rejected'), row('p2', 'pending_approval')];
    expect(nextInQueue(queue, 'p1', 'pending_approval')?.id).toBe('p2');
    expect(nextInQueue(queue, 'p2', 'pending_approval')?.id).toBe('p1');
  });

  it('is null when nothing else waits', () => {
    expect(nextInQueue([row('only', 'pending_approval')], 'only', 'pending_approval')).toBeNull();
    expect(nextInQueue(rows, 'd', 'pending_approval')).toBeNull();
  });

  it('a returned entry that is resubmitted moves on to the drafts', () => {
    expect(queueOf(row('r', 'rejected'))).toBe('draft');
    expect(queueOf(row('p', 'pending_approval'))).toBe('pending_approval');
  });
});
