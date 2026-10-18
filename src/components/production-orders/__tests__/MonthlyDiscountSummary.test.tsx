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
    // Sorted on the full name, so "Mountain Bakes DHA Branch" follows Gulshan.
    expect(cards().map((c) => c.firstElementChild?.textContent)).toEqual([
      'Gulshan Branch',
      'DHA Branch',
      'North Nazimabad Branch',
      'All Branches',
    ]);
    expect(card('DHA Branch').textContent).toContain('Total DiscountRs. 12,500');
    expect(card('North Nazimabad Branch').textContent).toContain('Rs. 8,750.5');
  });

  test('a branch with no claims shows Rs. 0 rather than being left out', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(card('Gulshan Branch').textContent).toContain('Total DiscountRs. 0');
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
    expect(cards()).toHaveLength(4);
    expect(card('North Nazimabad Branch').getAttribute('aria-current')).toBe('true');
    expect(card('DHA Branch').getAttribute('aria-current')).toBeNull();
  });

  test('a branch page shows no All Branches card', () => {
    const own = { ...SUMMARY, branches: SUMMARY.branches.filter((b) => b.branchId === A) };
    render(<MonthlyDiscountSummary {...base} summary={own} />);
    expect(cards().map((c) => c.firstElementChild?.textContent)).toEqual(['DHA Branch']);
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
    render(<MonthlyDiscountSummary {...base} summary={undefined} isError error={new Error('offline')} onRetry={onRetry} />);
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
    expect(cards()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('a fresh load carries no out-of-date notice', () => {
    render(<MonthlyDiscountSummary {...base} summary={SUMMARY} showBranches />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
