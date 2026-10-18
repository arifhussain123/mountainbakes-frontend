import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CurrentSaleRow } from '../admin-model';
import { CurrentBranchSales } from '../sections';

/**
 * Admin Dashboard → Current Sale by Branch: one card per branch (name in one
 * box, today's sale in the other), no table, and the loading, empty, error and
 * total states. The rows are what currentSaleRows() hands it (tested in
 * admin-model.test.ts); this covers how they are laid out.
 */

const format = (n: number | null | undefined) =>
  `Rs. ${Number(n ?? 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ROWS: CurrentSaleRow[] = [
  { branchId: 'a', branch: 'Committee Chowk Branch', sales: 15500, orders: 28 },
  { branchId: 'b', branch: 'Alabad Branch', sales: 7170, orders: 1 },
  { branchId: 'c', branch: 'Banigala Stall', sales: 0, orders: 0 },
];

const base = { rows: ROWS, total: 22670, loading: false, failed: false, onRetry: () => {}, businessDate: '2026-10-18', format };
const cards = () => screen.queryAllByTestId('current-sale-card');

afterEach(() => {
  cleanup();
});

describe('CurrentBranchSales', () => {
  test('one card per branch, in the order given, each with its name and current sale', () => {
    render(<CurrentBranchSales {...base} />);
    expect(cards()).toHaveLength(3);
    const first = cards()[0]!;
    expect(first.children).toHaveLength(2);
    expect(first.children[0]!.textContent).toBe('Committee Chowk Branch');
    expect(first.children[1]!.textContent).toBe('Current SaleRs. 15,500.0028 orders');
    expect(cards().map((c) => c.children[0]!.textContent)).toEqual(['Committee Chowk Branch', 'Alabad Branch', 'Banigala Stall']);
  });

  test('the table is gone', () => {
    render(<CurrentBranchSales {...base} />);
    const block = screen.getByTestId('current-sale-by-branch');
    expect(block.querySelector('table, ul, li')).toBeNull();
  });

  test('a branch with no sales shows Rs. 0.00 and says so', () => {
    render(<CurrentBranchSales {...base} />);
    const quiet = cards()[2]!;
    expect(within(quiet).getByText('Rs. 0.00')).toBeTruthy();
    expect(within(quiet).getByText('No sales yet')).toBeTruthy();
  });

  test('one order is singular', () => {
    render(<CurrentBranchSales {...base} />);
    expect(within(cards()[1]!).getByText('1 order')).toBeTruthy();
  });

  test('the day is today, whatever month the dashboard shows', () => {
    render(<CurrentBranchSales {...base} />);
    expect(screen.getByText(/Today · .*18 Oct 2026 · paid orders, cancelled and staff excluded/)).toBeTruthy();
  });

  test('the total today sits under the cards when there is more than one branch', () => {
    render(<CurrentBranchSales {...base} />);
    expect(screen.getByText('Total today').parentElement!.textContent).toBe('Total todayRs. 22,670.00');
  });

  test('no total for a single branch (the branch filter)', () => {
    render(<CurrentBranchSales {...base} rows={ROWS.slice(0, 1)} total={15500} />);
    expect(screen.queryByText('Total today')).toBeNull();
  });

  test('skeleton cards while today’s figures load, and no figures', () => {
    render(<CurrentBranchSales {...base} rows={[]} total={null} loading />);
    expect(screen.getAllByTestId('current-sale-card-skeleton').length).toBeGreaterThan(0);
    expect(cards()).toHaveLength(0);
    expect(screen.queryByText('Total today')).toBeNull();
  });

  test('no active branches is said, not left blank', () => {
    render(<CurrentBranchSales {...base} rows={[]} total={0} />);
    expect(screen.getByText('No active branches.')).toBeTruthy();
  });

  test('a failed load says so with a retry', () => {
    const onRetry = vi.fn();
    render(<CurrentBranchSales {...base} rows={[]} total={null} failed onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('a failed refresh keeps the cards already on screen', () => {
    render(<CurrentBranchSales {...base} failed />);
    expect(cards()).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
