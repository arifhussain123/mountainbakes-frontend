import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DailyTransferCheck, DailyTransferCheckRow, DailyTransferStatus } from '@mb/shared';
import { MissingCashTransfersPanel } from '../MissingCashTransfersPanel';

/**
 * Finance → Cash Transfer Details' Missing Daily Cash Transfers: the cards,
 * the grouped list, the statuses' wording, the View action, and when the
 * all-clear may be said. The check itself is the server's
 * (cash-transfer-missing.integration.test.ts); this lays it out.
 */

const ref = (n: number, status: 'pending' | 'approved' | 'rejected', amount: number, fuelCharges = 0) => ({
  id: `t${n}`, transferNo: `CT-00000${n}`, status, amount, fuelCharges, createdAt: '2026-10-25T10:00:00Z',
});
const row = (date: string, name: string, status: DailyTransferStatus, transfers: DailyTransferCheckRow['transfers'] = [], submittedAmount = 0): DailyTransferCheckRow => ({
  date, branchId: `${name}-id`, branchName: `Mountain Bakes ${name}`, status, transfers, submittedAmount,
});

function check(rows: DailyTransferCheckRow[], over: Partial<DailyTransferCheck> = {}): DailyTransferCheck {
  const count = (s: DailyTransferStatus) => rows.filter((r) => r.status === s).length;
  const unpaid = rows.filter((r) => ['missing', 'rejected', 'fuel_only'].includes(r.status));
  return {
    today: '2026-10-26', from: '2026-10-24', to: '2026-10-25', branchId: null, branches: 3, dates: 2,
    summary: {
      missingBranches: new Set(unpaid.map((r) => r.branchId)).size,
      affectedDates: new Set(unpaid.map((r) => r.date)).size,
      pendingTransfers: rows.flatMap((r) => r.transfers).filter((t) => t.status === 'pending').length,
      missing: count('missing'), fuelOnly: count('fuel_only'), rejected: count('rejected'), pending: count('pending'), approved: count('approved'),
    },
    rows,
    ...over,
  };
}

const MIXED = check([
  row('2026-10-25', 'Alpha', 'missing'),
  row('2026-10-25', 'Beta', 'pending', [ref(1, 'pending', 1500)], 1500),
  row('2026-10-25', 'Gamma', 'approved', [ref(2, 'approved', 900)], 900),
  row('2026-10-24', 'Alpha', 'rejected', [ref(3, 'rejected', 800)]),
  row('2026-10-24', 'Beta', 'fuel_only', [ref(4, 'approved', 0, 300)]),
  row('2026-10-24', 'Gamma', 'approved', [ref(5, 'approved', 700)], 700),
]);

const base = { isLoading: false, isError: false, isFetching: false, onRetry: () => {}, onView: () => {} };
const tile = (label: string) => screen.getByText(label, { exact: true }).parentElement!;
const desktop = () => document.querySelector('table')!;

afterEach(() => {
  cleanup();
});

describe('MissingCashTransfersPanel', () => {
  test('title, the window checked, and that today waits for 02:00', () => {
    render(<MissingCashTransfersPanel {...base} check={MIXED} />);
    expect(screen.getByRole('heading', { name: /Missing Daily Cash Transfers/ })).toBeTruthy();
    expect(screen.getByText(/3 active branches checked for 24 October 2026 – 25 October 2026/)).toBeTruthy();
    expect(screen.getByText(/Today \(26 October 2026\) is checked once its business day closes at 02:00/)).toBeTruthy();
  });

  test('three cards: branches missing, dates affected, transfers awaiting approval', () => {
    render(<MissingCashTransfersPanel {...base} check={MIXED} />);
    expect(tile('Branches with Missing Payments').textContent).toContain('23 unpaid days · 1 rejected · 1 fuel only');
    expect(tile('Affected Business Dates').textContent).toContain('2of 2 dates checked');
    expect(tile('Awaiting Approval').textContent).toContain('11 branch-day submitted');
  });

  test('grouped by date, newest first; approved days hidden until asked for', () => {
    render(<MissingCashTransfersPanel {...base} check={MIXED} />);
    const t = within(desktop());
    expect(t.getAllByRole('rowgroup').map((g) => g.querySelector('th[scope=rowgroup]')?.textContent ?? '').filter(Boolean))
      .toEqual(['25 October 20261 unpaid branch · 1 pending', '24 October 20262 unpaid branches']);
    expect(t.queryByText('Gamma')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show approved (2)' }));
    expect(within(desktop()).getAllByText('Gamma')).toHaveLength(2);
    expect(within(desktop()).getAllByText('Submitted / Approved')).toHaveLength(2);
  });

  test('each status reads as itself, with the transfer and the amount behind it', () => {
    render(<MissingCashTransfersPanel {...base} check={MIXED} />);
    const line = (name: string, date: string) => {
      const group = [...desktop().querySelectorAll('tbody')].find((g) => g.textContent!.startsWith(date))!;
      return [...group.querySelectorAll('tr')].find((tr) => tr.querySelector('td')?.textContent === name)!.textContent!;
    };
    expect(line('Alpha', '25 October')).toContain('Missing——No cash transfer recorded for this business date');
    expect(line('Beta', '25 October')).toContain('Pending ApprovalCT-000001Rs. 1,500Submitted — awaiting Finance approval');
    expect(line('Alpha', '24 October')).toContain('RejectedCT-000003Rs. 800 rejected');
    expect(line('Beta', '24 October')).toContain('Fuel onlyCT-000004Fuel Rs. 300');
  });

  test('View hands the row to the page', () => {
    const onView = vi.fn();
    render(<MissingCashTransfersPanel {...base} onView={onView} check={MIXED} />);
    fireEvent.click(within(desktop()).getAllByRole('button', { name: /View/ })[0]!);
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'Mountain Bakes Alpha', date: '2026-10-25', status: 'missing' }));
  });

  test('the all-clear is said only after real branches were checked over due dates', () => {
    const ALL = 'All required branches have submitted their daily cash transfers.';
    const paid = check([row('2026-10-25', 'Alpha', 'approved', [ref(1, 'approved', 100)], 100)]);
    render(<MissingCashTransfersPanel {...base} check={paid} />);
    expect(screen.getByText(ALL)).toBeTruthy();
    cleanup();
    // Submitted but awaiting Finance still counts as submitted.
    render(<MissingCashTransfersPanel {...base} check={check([row('2026-10-25', 'Alpha', 'pending', [ref(1, 'pending', 100)], 100)])} />);
    expect(screen.getByText(ALL)).toBeTruthy();
    cleanup();
    render(<MissingCashTransfersPanel {...base} check={MIXED} />);
    expect(screen.queryByText(ALL)).toBeNull();
    cleanup();
    // Nothing due yet, or nothing to check: no all-clear.
    render(<MissingCashTransfersPanel {...base} check={check([], { from: '2026-10-26', to: '2026-10-25', dates: 0 })} />);
    expect(screen.queryByText(ALL)).toBeNull();
    expect(screen.getByText(/Nothing in this date range is due yet/)).toBeTruthy();
    cleanup();
    render(<MissingCashTransfersPanel {...base} check={check([], { branches: 0 })} />);
    expect(screen.queryByText(ALL)).toBeNull();
    expect(screen.getByText('No active branches to check.')).toBeTruthy();
    cleanup();
    render(<MissingCashTransfersPanel {...base} isLoading check={undefined} />);
    expect(screen.queryByText(ALL)).toBeNull();
  });

  test('an error with nothing loaded shows the retry block; a refresh keeps the last check on screen', () => {
    const onRetry = vi.fn();
    render(<MissingCashTransfersPanel {...base} isError onRetry={onRetry} check={undefined} />);
    expect(screen.getByText('Unable to load the missing cash transfers check')).toBeTruthy();
    cleanup();
    render(<MissingCashTransfersPanel {...base} isFetching check={MIXED} />);
    expect(screen.getByRole('region', { name: 'Missing Daily Cash Transfers' }).className).toContain('opacity-70');
    expect(within(desktop()).getAllByText('Alpha', { selector: 'td' })).toHaveLength(2);
  });
});
