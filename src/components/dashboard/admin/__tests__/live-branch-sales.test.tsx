import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LiveSaleRow } from '../admin-model';
import { LiveBranchSales } from '../sections';

/**
 * Admin Dashboard → Live Sales — All Branches: one card per branch with its
 * sale for the period, the combined total, the period picker, and the loading,
 * empty, error and not-live states. The rows are what liveSaleRows() hands it
 * (tested in admin-model.test.ts); this covers how they are laid out.
 */

const format = (n: number | null | undefined) =>
  `Rs. ${Number(n ?? 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ROWS: LiveSaleRow[] = [
  { branchId: 'a', branch: 'Committee Chowk Branch', sales: 15500, orders: 28 },
  { branchId: 'b', branch: 'Alabad Branch', sales: 7170, orders: 1 },
  { branchId: 'c', branch: 'Banigala Stall', sales: 0, orders: 0 },
];

const UPDATED = new Date('2026-10-21T10:15:30Z').getTime();

const base = {
  rows: ROWS,
  loading: false,
  failed: false,
  onRetry: () => {},
  period: 'today' as const,
  onPeriod: () => {},
  custom: { from: '2026-10-21', to: '2026-10-21' },
  onCustom: () => {},
  today: '2026-10-21',
  from: '2026-10-21',
  to: '2026-10-21',
  status: 'live' as const,
  updatedAt: UPDATED,
  format,
};
const cards = () => screen.queryAllByTestId('live-sale-card');

afterEach(() => {
  cleanup();
});

describe('LiveBranchSales', () => {
  test('titled Live Sales — All Branches', () => {
    render(<LiveBranchSales {...base} />);
    expect(screen.getByRole('heading', { name: 'Live Sales — All Branches' })).toBeTruthy();
  });

  test('one card per branch, in the order given, each with its name, sale and the period', () => {
    render(<LiveBranchSales {...base} />);
    expect(cards()).toHaveLength(3);
    const first = cards()[0]!;
    expect(first.children[0]!.textContent).toBe('Committee Chowk Branch');
    expect(first.children[1]!.textContent).toBe("Rs. 15,500.00Today's Sales28 orders");
  });

  test('a branch with no sales shows Rs. 0.00 and says so', () => {
    render(<LiveBranchSales {...base} />);
    const quiet = cards()[2]!;
    expect(within(quiet).getByText('Rs. 0.00')).toBeTruthy();
    expect(within(quiet).getByText('No sales yet')).toBeTruthy();
  });

  test('the total is the sum of the cards', () => {
    render(<LiveBranchSales {...base} />);
    expect(screen.getByTestId('live-sales-total').textContent).toBe('Total Sales29 ordersRs. 22,670.00');
  });

  test('a single branch still gets its total', () => {
    render(<LiveBranchSales {...base} rows={ROWS.slice(0, 1)} />);
    expect(screen.getByTestId('live-sales-total').textContent).toContain('Rs. 15,500.00');
  });

  test('the period is labelled on the board and on every card', () => {
    render(<LiveBranchSales {...base} period="month" from="2026-10-01" />);
    expect(screen.getByText(/This Month's Sales · 01 Oct – 21 Oct 2026 · paid orders/)).toBeTruthy();
    expect(within(cards()[0]!).getByText("This Month's Sales")).toBeTruthy();
  });

  test('the period buttons report the choice; Custom Date shows two date fields', () => {
    const onPeriod = vi.fn();
    const { rerender } = render(<LiveBranchSales {...base} onPeriod={onPeriod} />);
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('From date')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onPeriod).toHaveBeenCalledWith('yesterday');
    rerender(<LiveBranchSales {...base} period="custom" />);
    expect(screen.getByLabelText('From date').getAttribute('max')).toBe('2026-10-21');
    expect(screen.getByLabelText('To date')).toBeTruthy();
  });

  test('a custom from-date after the to-date moves the to-date with it', () => {
    const onCustom = vi.fn();
    render(<LiveBranchSales {...base} period="custom" custom={{ from: '2026-10-02', to: '2026-10-05' }} onCustom={onCustom} />);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-09' } });
    expect(onCustom).toHaveBeenCalledWith({ from: '2026-10-09', to: '2026-10-09' });
  });

  test('live: says so with the time of the last update', () => {
    render(<LiveBranchSales {...base} />);
    expect(screen.getByTestId('live-sales-status').textContent).toMatch(/^Live · updated /);
  });

  test('stopped updates are never shown as live', () => {
    for (const [status, text] of [
      ['stale', /^Not updating · last updated /],
      ['offline', /^Offline · showing figures from /],
      ['error', /^Could not refresh · showing figures from /],
      ['closed', /^Closed period · loaded /],
    ] as const) {
      render(<LiveBranchSales {...base} status={status} />);
      const s = screen.getByTestId('live-sales-status').textContent!;
      expect(s).toMatch(text);
      expect(s).not.toMatch(/^Live/);
      cleanup();
    }
  });

  test('skeleton cards while the figures load, and no figures or total', () => {
    render(<LiveBranchSales {...base} rows={[]} loading status="loading" updatedAt={null} />);
    expect(screen.getAllByTestId('live-sale-card-skeleton').length).toBeGreaterThan(0);
    expect(cards()).toHaveLength(0);
    expect(screen.queryByTestId('live-sales-total')).toBeNull();
    expect(screen.queryByTestId('live-sales-status')).toBeNull();
  });

  test('no active branches is said, not left blank', () => {
    render(<LiveBranchSales {...base} rows={[]} />);
    expect(screen.getByText('There are no active branches to show.')).toBeTruthy();
  });

  test('a failed first load says so with a retry, and shows no figures', () => {
    const onRetry = vi.fn();
    render(<LiveBranchSales {...base} rows={[]} failed onRetry={onRetry} status="loading" updatedAt={null} />);
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    expect(screen.queryByTestId('live-sales-total')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('a failed refresh keeps the cards, flagged, with a retry', () => {
    render(<LiveBranchSales {...base} failed status="error" />);
    expect(cards()).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(screen.getByTestId('live-sales-status')).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
