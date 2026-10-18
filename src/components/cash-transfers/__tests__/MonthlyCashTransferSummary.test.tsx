import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildCashTransferSummary, type CashTransferSummaryRow } from '@mb/shared';
import { MonthlyCashTransferSummary } from '../MonthlyCashTransferSummary';

/**
 * Branch → Cash Transfer Details' monthly summary: the eight cards, their
 * wording, and the loading, empty and error states. Payloads come from the
 * same shared builder the API uses, so the figures are the server's.
 */

const BRANCH = '00000000-0000-4000-8000-00000000000a';
const RANGE = { from: '2026-10-01', to: '2026-10-18' };
const row = (status: string, r: Partial<CashTransferSummaryRow>): CashTransferSummaryRow => ({
  status, transfers: 0, amount: 0, amountCount: 0, cash: 0, cashCount: 0, easypaisa: 0, easypaisaCount: 0,
  bank: 0, bankCount: 0, fuel: 0, fuelCount: 0, ...r,
});

const SUMMARY = buildCashTransferSummary(
  [
    row('approved', { transfers: 3, amount: 20000, amountCount: 3, cash: 15000, cashCount: 3, bank: 5000, bankCount: 1, fuel: 300, fuelCount: 1 }),
    row('pending', { transfers: 1, amount: 3720, amountCount: 1, easypaisa: 3720, easypaisaCount: 1 }),
  ],
  RANGE,
  BRANCH,
);
const EMPTY = buildCashTransferSummary([], RANGE, BRANCH);

const base = { isLoading: false, isError: false, isFetching: false, error: null, onRetry: () => {} };
const tile = (label: string) => screen.getByText(label, { exact: true }).parentElement!;

afterEach(() => {
  cleanup();
});

describe('MonthlyCashTransferSummary', () => {
  test('header: the server window, when it starts again, and the Finance note', () => {
    render(<MonthlyCashTransferSummary {...base} summary={SUMMARY} />);
    expect(screen.getByRole('heading').textContent).toBe('Monthly Transfers: 1 October 2026 – 18 October 2026');
    expect(screen.getByText(/Month to date, Karachi business day · starts again on 1 November 2026/)).toBeTruthy();
    expect(screen.getByText('Approved transfers are confirmed by Finance')).toBeTruthy();
  });

  test('eight cards in order, with the money and the transfer counts', () => {
    render(<MonthlyCashTransferSummary {...base} summary={SUMMARY} />);
    const labels = [...document.querySelectorAll('section .grid > div > p:first-child')].map((p) => p.textContent);
    expect(labels).toEqual(['Total Transferred', 'Cash', 'Easypaisa', 'Bank', 'Approved', 'Awaiting Finance', 'Rejected', 'Fuel Charges']);
    expect(tile('Total Transferred').textContent).toBe('Total TransferredRs. 23,7204 transfers · every status');
    expect(tile('Cash').textContent).toContain('Rs. 15,0003 transfers');
    expect(tile('Approved').textContent).toContain('Rs. 20,000');
    expect(tile('Awaiting Finance').textContent).toContain('Rs. 3,720');
    expect(tile('Fuel Charges').textContent).toContain('Rs. 300across 1 transfer');
  });

  test('one transfer is singular', () => {
    render(<MonthlyCashTransferSummary {...base} summary={SUMMARY} />);
    expect(tile('Bank').textContent).toContain('1 transfer');
    expect(tile('Bank').textContent).not.toContain('1 transfers');
  });

  test('status cards carry their colours: approved green, awaiting amber, rejected red', () => {
    render(<MonthlyCashTransferSummary {...base} summary={SUMMARY} />);
    expect(tile('Approved').children[1]!.className).toContain('text-emerald-700');
    expect(tile('Awaiting Finance').children[1]!.className).toContain('text-amber-700');
    expect(tile('Rejected').children[1]!.className).toContain('text-red-700');
  });

  test('no transfers this month: every card shown at Rs. 0 with 0 transfers', () => {
    render(<MonthlyCashTransferSummary {...base} summary={EMPTY} />);
    const values = [...document.querySelectorAll('section .grid > div > p:nth-child(2)')].map((p) => p.textContent);
    expect(values).toHaveLength(8);
    expect(new Set(values)).toEqual(new Set(['Rs. 0']));
    expect(tile('Total Transferred').textContent).toContain('0 transfers · every status');
    expect(tile('Fuel Charges').textContent).toContain('across 0 transfers');
  });

  test('loading: eight skeleton cards and no figures', () => {
    render(<MonthlyCashTransferSummary {...base} summary={undefined} isLoading />);
    expect(screen.getAllByTestId('summary-tile-skeleton')).toHaveLength(8);
    expect(screen.queryByText('Total Transferred')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('Monthly Transfers');
  });

  test('error: an inline message with a retry, and no cards', () => {
    const onRetry = vi.fn();
    render(<MonthlyCashTransferSummary {...base} summary={undefined} isError error={new Error('offline')} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Unable to load the monthly transfers summary');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Total Transferred')).toBeNull();
  });

  test('a failed refresh keeps the last figures on screen', () => {
    render(<MonthlyCashTransferSummary {...base} summary={SUMMARY} isError error={new Error('offline')} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(tile('Total Transferred').textContent).toContain('Rs. 23,720');
  });
});
