import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildReturnsSummary, type ProductionReturnStatus, type ReturnsSummaryRow } from '@mb/shared';
import { MonthlyReturnsSummary } from '../MonthlyReturnsSummary';

/**
 * Production → Product Returns' monthly summary: one return-amount box per
 * active branch in place of the old branch-wise table. The payload is made by
 * the same shared builder the API uses, so the figures are the server's.
 */

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const X = '00000000-0000-4000-8000-0000000000ff';

const row = (o: Partial<ReturnsSummaryRow>): ReturnsSummaryRow => ({
  branchId: A, branchName: 'Alabad Branch', status: 'accepted',
  productId: 'p1', productName: 'Fudge Pastry', productCode: 'FP-01',
  count: 1, qty: 1, amount: 100, unpriced: 0, ...o,
});

const SUMMARY = buildReturnsSummary(
  [
    row({ status: 'accepted', count: 2, qty: 4, amount: 12000 }),
    row({ status: 'pending', count: 1, qty: 2, amount: 400.5 }),
    row({ status: 'returned', count: 1, qty: 1, amount: 99.5 }),
    row({ status: 'rejected', count: 1, qty: 3, amount: 777 }),
    row({ branchId: B, branchName: 'Committee Chowk Branch', status: 'rejected', count: 1, qty: 1, amount: 150 }),
    row({ branchId: X, branchName: 'Saddar Branch', status: 'accepted', count: 1, qty: 1, amount: 60 }),
  ],
  [
    { id: A, name: 'Alabad Branch' },
    { id: B, name: 'Committee Chowk Branch' },
    { id: C, name: 'Commercial Market Branch' },
  ],
  { from: '2026-10-01', to: '2026-10-18' },
);

const BRANCHES = [
  { id: A, name: 'Alabad Branch', isActive: true },
  { id: B, name: 'Committee Chowk Branch', isActive: true },
  { id: C, name: 'Commercial Market Branch', isActive: true },
  { id: X, name: 'Saddar Branch', isActive: false },
];

const LABELS: Record<ProductionReturnStatus, string> = {
  pending: 'Awaiting Review', accepted: 'Approved', rejected: 'Rejected', returned: 'Sent Back to Branch',
};

const base = { isLoading: false, isError: false, isFetching: false, error: null, onRetry: () => {}, statusLabels: LABELS };
const boxes = () => screen.getAllByTestId('return-branch-box');
const box = (name: string) => boxes().find((b) => b.textContent?.startsWith(name))!;

afterEach(() => {
  cleanup();
});

describe('MonthlyReturnsSummary — Production branch boxes', () => {
  test('the branch-wise table is gone', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Monthly Return Amount by Branch')).toBeTruthy();
  });

  test('one box per active branch with an amount, name and amount in separate parts', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} />);
    expect(boxes().map((b) => b.firstElementChild?.textContent)).toEqual(['Alabad Branch']);
    expect(box('Alabad Branch').lastElementChild?.textContent).toBe('Rs. 12,500.00');
  });

  test('approved, awaiting review and sent back count; rejected does not', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} />);
    expect(box('Alabad Branch').textContent).not.toContain('777');
    // Committee Chowk's only return was rejected, so it has nothing to show.
    expect(boxes().some((b) => b.textContent?.startsWith('Committee Chowk'))).toBe(false);
  });

  test('a branch with no returns gets no box, nor does an inactive one', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} />);
    expect(boxes().some((b) => b.textContent?.startsWith('Commercial Market'))).toBe(false);
    expect(boxes().some((b) => b.textContent?.startsWith('Saddar'))).toBe(false);
  });

  test('clicking a box selects that branch; clicking it again clears it', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} onSelectBranch={onSelect} />,
    );
    fireEvent.click(box('Alabad Branch'));
    expect(onSelect).toHaveBeenLastCalledWith(A);
    rerender(
      <MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} selectedBranchId={A} onSelectBranch={onSelect} />,
    );
    expect(box('Alabad Branch').getAttribute('aria-pressed')).toBe('true');
    expect(boxes()).toHaveLength(1);
    fireEvent.click(box('Alabad Branch'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  test('a selected branch keeps its box at Rs. 0.00 so it can be cleared', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} selectedBranchId={B} />);
    expect(boxes().map((b) => b.firstElementChild?.textContent)).toEqual(['Alabad Branch', 'Committee Chowk Branch']);
    expect(box('Committee Chowk Branch').lastElementChild?.textContent).toBe('Rs. 0.00');
  });

  test('a selected branch narrows the cards to its own figures', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} selectedBranchId={A} />);
    expect(screen.getByText('Total Return Amount').nextElementSibling?.textContent).toBe('Rs. 13,277');
    expect(screen.getByRole('heading', { level: 3, name: /Alabad Branch/ })).toBeTruthy();
  });

  test('a selected branch with no entry shows zero cards, not a skeleton', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} selectedBranchId={X} />);
    expect(screen.getByText('Total Return Amount').nextElementSibling?.textContent).toBe('Rs. 60');
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} selectedBranchId="00000000-0000-4000-8000-000000000999" />);
    expect(screen.getAllByText('Total Return Amount')[1]!.nextElementSibling?.textContent).toBe('Rs. 0');
  });

  test('states the month and when it starts again', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={BRANCHES} />);
    expect(screen.getByText(/Monthly Returns: 1 October 2026 – 18 October 2026/)).toBeTruthy();
    expect(screen.getByText(/starts again on 1 November 2026/)).toBeTruthy();
  });

  test('box skeletons until the branch list arrives', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} showBranches branches={undefined} />);
    expect(screen.getAllByTestId('return-branch-skeleton')).toHaveLength(4);
  });

  test('a failed first load offers a retry', () => {
    const onRetry = vi.fn();
    render(<MonthlyReturnsSummary {...base} summary={undefined} isError error={new Error('offline')} onRetry={onRetry} showBranches branches={BRANCHES} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryAllByTestId('return-branch-box')).toHaveLength(0);
  });

  test('the branch page shows no boxes', () => {
    render(<MonthlyReturnsSummary {...base} summary={SUMMARY} branches={BRANCHES} />);
    expect(screen.queryAllByTestId('return-branch-box')).toHaveLength(0);
    expect(screen.queryByText('Monthly Return Amount by Branch')).toBeNull();
  });
});
