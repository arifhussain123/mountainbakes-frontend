import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildDiscountSummary } from '@mb/shared';
import { MonthlyDiscountSummary } from '../MonthlyDiscountSummary';

/**
 * The Discounts pages' monthly summary: one card per branch with the name and
 * the approved Total Discount in separate sections, and its loading, empty,
 * error and failed-refresh states. The payload is made by the same shared
 * builder the API uses, so the figures on screen are the server's.
 */

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const RANGE = { from: '2026-10-01', to: '2026-10-18' };

const SUMMARY = buildDiscountSummary(
  [
    { branchId: A, branchName: 'Mountain Bakes DHA Branch', status: 'approved', count: 2, amount: 12500 },
    { branchId: A, branchName: 'Mountain Bakes DHA Branch', status: 'pending', count: 1, amount: 300 },
    { branchId: B, branchName: 'North Nazimabad Branch', status: 'approved', count: 3, amount: 8750.5 },
    { branchId: B, branchName: 'North Nazimabad Branch', status: 'rejected', count: 1, amount: 999 },
  ],
  [
    { id: A, name: 'Mountain Bakes DHA Branch' },
    { id: B, name: 'North Nazimabad Branch' },
    { id: C, name: 'Gulshan Branch' },
  ],
  RANGE,
);

const base = { isLoading: false, isError: false, isFetching: false, error: null, onRetry: () => {} };

const cards = () => screen.getAllByTestId('discount-summary-card');
const card = (name: string) => cards().find((c) => c.textContent?.startsWith(name))!;

afterEach(() => {
  cleanup();
});

describe('MonthlyDiscountSummary', () => {
  test('one card per branch in the server order, each with its name and the approved Total Discount', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(cards().map((c) => c.firstElementChild?.textContent)).toEqual([
      'DHA Branch',
      'North Nazimabad Branch',
      'All Branches',
    ]);
    expect(card('DHA Branch').textContent).toContain('Total DiscountRs. 12,500');
    expect(card('North Nazimabad Branch').textContent).toContain('Rs. 8,750.5');
  });

  test('a branch with nothing this month gets no card', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(card('Gulshan Branch')).toBeUndefined();
  });

  test('a branch with only claims awaiting review keeps its card, at Rs. 0 approved', () => {
    const pendingOnly = buildDiscountSummary(
      [{ branchId: C, branchName: 'Gulshan Branch', status: 'pending', count: 2, amount: 400 }],
      [{ id: C, name: 'Gulshan Branch' }],
      RANGE,
    );
    render(<MonthlyDiscountSummary {...base} summary={pendingOnly} showBranches />);
    expect(card('Gulshan Branch').textContent).toContain('Total DiscountRs. 0');
    expect(card('Gulshan Branch').textContent).toContain('Rs. 400 awaiting review');
  });

  test('the branch the page is filtered to stays, even at Rs. 0', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches highlightBranchId={C} />);
    expect(card('Gulshan Branch').getAttribute('aria-current')).toBe('true');
    expect(cards()).toHaveLength(4);
  });

  test('a month with no discounts at any branch says so', () => {
    const empty = buildDiscountSummary([], [{ id: C, name: 'Gulshan Branch' }], RANGE);
    render(<MonthlyDiscountSummary {...base} summary={empty} showBranches />);
    expect(screen.getByText('No branch discounts this month.')).toBeTruthy();
    expect(screen.queryAllByTestId('discount-summary-card')).toHaveLength(0);
  });

  test('pending is its own line, not added in; rejected is in no figure', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(card('DHA Branch').textContent).toContain('Rs. 300 awaiting review · 1 claim');
    expect(card('North Nazimabad Branch').textContent).not.toContain('999');
    expect(card('All Branches').textContent).toContain('Rs. 21,250.5');
  });

  test('states the server period', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(screen.getByText(/Period: 1 October 2026 – 18 October 2026/)).toBeTruthy();
  });

  test('the filtered branch is marked and every other card stays', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches highlightBranchId={B} />);
    expect(cards()).toHaveLength(3);
    expect(card('North Nazimabad Branch').getAttribute('aria-current')).toBe('true');
    expect(card('DHA Branch').getAttribute('aria-current')).toBeNull();
  });


  test('skeletons while the first load runs', () => {
    render(<MonthlyDiscountSummary {...base} summary={undefined} isLoading showBranches />);
    expect(screen.getAllByTestId('discount-summary-skeleton')).toHaveLength(4);
    expect(screen.queryAllByTestId('discount-summary-card')).toHaveLength(0);
  });

  test('no active branches is said, not left blank', () => {
    render(<MonthlyDiscountSummary {...base} summary={{ ...SUMMARY, branches: [] }} showBranches />);
    expect(screen.getByText('No active branches.')).toBeTruthy();
  });

  test('a first load that fails offers a retry and no figures', () => {
    const onRetry = vi.fn();
    render(<MonthlyDiscountSummary {...base} summary={undefined} isError error={new Error('offline')} onRetry={onRetry} showBranches />);
    expect(screen.getByRole('alert').textContent).toContain('Unable to load the monthly discount summary');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryAllByTestId('discount-summary-card')).toHaveLength(0);
  });

  test('a failed refresh keeps the last figures but says they may be out of date', () => {
    const onRetry = vi.fn();
    const loadedAt = new Date('2026-10-18T09:15:00').getTime();
    render(
      <MonthlyDiscountSummary {...base} summary={SUMMARY} isError error={new Error('offline')} onRetry={onRetry} updatedAt={loadedAt} showBranches />,
    );
    expect(screen.getByRole('status').textContent).toContain('Could not refresh — showing the figures loaded at 9:15 AM, 18 Oct');
    expect(cards()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('a fresh load carries no out-of-date notice', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

/** Branch → Discounts: the branch's own total, one full-width card like Shop Expenses'. */
describe('MonthlyDiscountSummary, branch view', () => {
  const ownSummary = (approved: { count: number; amount: number }, pending = { count: 0, amount: 0 }) =>
    buildDiscountSummary(
      [
        ...(approved.count ? [{ branchId: A, branchName: 'Committee Chowk Branch', status: 'approved' as const, ...approved }] : []),
        ...(pending.count ? [{ branchId: A, branchName: 'Committee Chowk Branch', status: 'pending' as const, ...pending }] : []),
      ],
      [{ id: A, name: 'Committee Chowk Branch' }],
      RANGE,
    );

  test('one card: the period start in the label, the approved total and the claim count, no branch name', () => {
    render(<MonthlyDiscountSummary {...base} summary={ownSummary({ count: 17, amount: 12200 })} currencySymbol="Rs.  " />);
    expect(cards()).toHaveLength(1);
    const c = cards()[0]!;
    expect(c.textContent).toContain('Total discount (since 2026-10-01)');
    expect(c.textContent).toContain('17 claims approved');
    expect(c.textContent).toContain('Rs.  12,200');
    expect(c.textContent).not.toContain('Committee Chowk');
    expect(screen.queryByText('All Branches')).toBeNull();
  });

  test('one claim is singular', () => {
    render(<MonthlyDiscountSummary {...base} summary={ownSummary({ count: 1, amount: 500 })} currencySymbol="Rs. " />);
    expect(cards()[0]!.textContent).toContain('1 claim approved');
    expect(cards()[0]!.textContent).not.toContain('1 claims');
  });

  test('no approved claims still shows the card, at Rs. 0', () => {
    render(<MonthlyDiscountSummary {...base} summary={ownSummary({ count: 0, amount: 0 })} currencySymbol="Rs. " />);
    expect(cards()[0]!.textContent).toContain('Rs. 0');
    expect(cards()[0]!.textContent).toContain('No approved claims yet');
  });

  test('claims awaiting review are their own line, not added in', () => {
    render(<MonthlyDiscountSummary {...base} summary={ownSummary({ count: 2, amount: 1000 }, { count: 1, amount: 300 })} currencySymbol="Rs. " />);
    expect(cards()[0]!.textContent).toContain('Rs. 1,000');
    expect(cards()[0]!.textContent).toContain('Rs. 300 awaiting review · 1 claim');
  });

  test('the period sits under the heading', () => {
    render(<MonthlyDiscountSummary {...base} summary={ownSummary({ count: 17, amount: 12200 })} />);
    const heading = screen.getByRole('heading', { name: 'Monthly Discount Summary' });
    expect(heading.nextElementSibling?.textContent).toContain('Period: 1 October 2026 – 18 October 2026 · approved claims');
  });

  test('a skeleton card while the first load runs', () => {
    render(<MonthlyDiscountSummary {...base} summary={undefined} isLoading />);
    expect(screen.getByTestId('discount-summary-card-skeleton')).toBeTruthy();
    expect(screen.queryAllByTestId('discount-summary-card')).toHaveLength(0);
  });

  test('a failed first load says so inside the card, with a retry', () => {
    const onRetry = vi.fn();
    render(<MonthlyDiscountSummary {...base} summary={undefined} isError error={new Error('offline')} onRetry={onRetry} />);
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('Could not load the discount summary.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('a failed refresh keeps the figures but says they may be out of date', () => {
    render(<MonthlyDiscountSummary {...base} summary={ownSummary({ count: 17, amount: 12200 })} isError error={new Error('offline')} />);
    expect(screen.getByRole('status').textContent).toContain('Could not refresh');
    expect(cards()[0]!.textContent).toContain('17 claims approved');
  });
});
