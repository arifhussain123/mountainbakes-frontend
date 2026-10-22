import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { buildReturnMonthSummary, type ReturnMonthSqlRow } from '@mb/shared';
import { useProductionReturnMonthSummary } from '@/lib/queries';
import { ProductionReturnSummaryPage } from '../ProductionReturnSummaryPage';

/**
 * Return Summary's page: cards, the item-wise box and the branch-wise table
 * drawn from one payload; the search narrowing only the table; month stepping;
 * empty and error states. The data hook is replaced, and the payload is built
 * by the same shared builder the API uses, so its shape cannot drift.
 */

vi.mock('@/lib/queries', () => ({ useProductionReturnMonthSummary: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't' }) }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const useMonth = vi.mocked(useProductionReturnMonthSummary);

const NOW = new Date('2026-10-18T10:00:00+05:00');
const row = (over: Partial<ReturnMonthSqlRow>): ReturnMonthSqlRow => ({
  branchId: 'A', branchName: 'DHA Branch', productId: 'P1', productName: 'Chocolate Pastry',
  reason: 'damaged', count: 1, qty: 5, amount: 750, unpriced: 0, ...over,
});
const OCTOBER = buildReturnMonthSummary(
  [
    row({}),
    row({ reason: 'unsold', qty: 3, amount: 450 }),
    row({ branchId: 'B', branchName: 'North Nazimabad Branch', reason: 'unsold', qty: 4, amount: 600 }),
    row({ productId: 'P2', productName: 'Cream Puff', qty: 6, amount: 300 }),
  ],
  '2026-10',
  NOW,
);

function state(over: Partial<{ data: unknown; isError: boolean; isFetching: boolean }> = {}) {
  return { data: undefined, isError: false, error: null, isFetching: false, refetch: vi.fn(), ...over } as never;
}

beforeEach(() => useMonth.mockReturnValue(state({ data: OCTOBER })));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProductionReturnSummaryPage', () => {
  test('names the month and its days, and shows the four cards', () => {
    render(<ProductionReturnSummaryPage />);
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(screen.getByText(/1 October 2026 – 31 October 2026/)).toBeTruthy();
    expect(screen.getByText('Total Returned Quantity').nextSibling?.textContent).toBe('18');
    expect(screen.getByText('Total Return Amount').nextSibling?.textContent).toBe('Rs. 2,100');
    expect(screen.getByText('Branches with Returns').nextSibling?.textContent).toBe('2');
    expect(screen.getByText('Unique Items Returned').nextSibling?.textContent).toBe('2');
  });

  test('the item-wise box lists each item once with every branch added, and opens its branches', () => {
    render(<ProductionReturnSummaryPage />);
    const box = screen.getByRole('region', { name: 'All Branches — Item-Wise Total Returns' });
    const choc = within(box).getByRole('button', { name: /Chocolate Pastry/ });
    expect(choc.textContent).toContain('12');
    expect(within(box).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(choc);
    expect(choc.getAttribute('aria-expanded')).toBe('true');
    expect(within(box).getByText('North Nazimabad Branch')).toBeTruthy();
  });

  test('searching narrows the branch-wise table only — the cards and item box keep the whole month', () => {
    render(<ProductionReturnSummaryPage />);
    const table = screen.getByRole('region', { name: 'Branch-Wise Return Summary' });
    fireEvent.change(screen.getByLabelText('Search item name'), { target: { value: 'cream' } });
    expect(within(table).queryAllByText('Chocolate Pastry')).toHaveLength(0);
    expect(within(table).getAllByText('Cream Puff').length).toBeGreaterThan(0);
    expect(screen.getByText('Total Returned Quantity').nextSibling?.textContent).toBe('18');
    const box = screen.getByRole('region', { name: 'All Branches — Item-Wise Total Returns' });
    expect(within(box).getByRole('button', { name: /Chocolate Pastry/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Clear filters/ })[0]!);
    expect(within(table).getAllByText('Chocolate Pastry').length).toBeGreaterThan(0);
  });

  test('steps back a month, never forward past the current one', () => {
    render(<ProductionReturnSummaryPage />);
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(useMonth).toHaveBeenLastCalledWith('t', '2026-09');
  });

  test('Back returns to Product Returns', () => {
    render(<ProductionReturnSummaryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Product Returns/ }));
    expect(push).toHaveBeenCalledWith('/production-returns');
  });

  test('an empty month says so instead of drawing empty tables', () => {
    useMonth.mockReturnValue(state({ data: buildReturnMonthSummary([], '2026-10', NOW) }));
    render(<ProductionReturnSummaryPage />);
    expect(screen.getByText('No returns in October 2026')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Branch-Wise Return Summary' })).toBeNull();
  });

  test('a failed request offers Retry', () => {
    const refetch = vi.fn();
    useMonth.mockReturnValue({ ...(state({ isError: true }) as object), refetch } as never);
    render(<ProductionReturnSummaryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
