import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  formatSignedRupees,
  reconcileMethod,
  verifyDailySale,
  type DailySaleRecord,
  type VerifyRecordFields,
} from '@mb/shared';
import { ReconciliationPanel } from '../ReconciliationPanel';
import { ManualFeedDialog } from '../ManualFeedDialog';
import { MethodDiffBadge } from '../parts';

/**
 * Daily Sale Record: counted Cash and received Easypaisa against the table,
 * each with a signed difference, and the day VERIFIED only when every required
 * figure matches exactly. Saved records read the database's own differences;
 * a count being typed is worked out in whole paisa.
 */

vi.mock('@/lib/queries', () => ({
  useDailySaleLocks: () => ({ data: [] }),
  useFeedDailySale: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/**
 * A saved day: Cash on Table 10,000, Easypaisa 5,000, no bank. The differences
 * are worked out here the way the database's generated columns do.
 */
function day(counted: { cash?: number | null; easypaisa?: number | null; bank?: number | null } = {}, table: Partial<VerifyRecordFields> = {}) {
  const cash = counted.cash === undefined ? 10000 : counted.cash;
  const ep = counted.easypaisa === undefined ? 5000 : counted.easypaisa;
  const bank = counted.bank === undefined ? null : counted.bank;
  const t = { expectedCashInHand: 10000, autoEasypaisa: 5000, autoBank: 0, ...table };
  const diff = (c: number | null, tbl: number) => (c === null ? null : Math.round((c - tbl) * 100) / 100);
  return {
    ...t,
    manualCash: cash,
    manualEasypaisa: ep,
    manualBank: bank,
    cashDifference: diff(cash, t.expectedCashInHand),
    easypaisaDifference: diff(ep, t.autoEasypaisa),
    bankDifference: diff(bank, t.autoBank),
  } satisfies VerifyRecordFields;
}

afterEach(cleanup);

describe('verifyDailySale', () => {
  test('1. Cash and Easypaisa both match → VERIFIED', () => {
    const v = verifyDailySale(day());
    expect(v.verified).toBe(true);
    expect(v.cash).toMatchObject({ difference: 0, status: 'match' });
    expect(v.easypaisa).toMatchObject({ difference: 0, status: 'match' });
    expect(v.problems).toEqual([]);
  });

  test('2. cash lower than the table → negative difference, NOT VERIFIED', () => {
    const v = verifyDailySale(day({ cash: 9500 }));
    expect(v.cash).toMatchObject({ difference: -500, status: 'short' });
    expect(v.verified).toBe(false);
    expect(v.problems).toEqual(['Cash − Rs. 500']);
  });

  test('3. cash higher than the table → positive difference, NOT VERIFIED', () => {
    const v = verifyDailySale(day({ cash: 10500 }));
    expect(v.cash).toMatchObject({ difference: 500, status: 'over' });
    expect(v.problems).toEqual(['Cash + Rs. 500']);
  });

  test('4. Easypaisa lower than the table → negative difference, NOT VERIFIED', () => {
    const v = verifyDailySale(day({ easypaisa: 4800 }));
    expect(v.easypaisa).toMatchObject({ difference: -200, status: 'short' });
    expect(v.problems).toEqual(['Easypaisa − Rs. 200']);
  });

  test('5. Easypaisa higher than the table → positive difference, NOT VERIFIED', () => {
    const v = verifyDailySale(day({ easypaisa: 5200 }));
    expect(v.easypaisa).toMatchObject({ difference: 200, status: 'over' });
    expect(v.verified).toBe(false);
  });

  test('6. both out → both differences named', () => {
    expect(verifyDailySale(day({ cash: 9500, easypaisa: 5200 })).problems).toEqual(['Cash − Rs. 500', 'Easypaisa + Rs. 200']);
  });

  test('7. a missing figure is never VERIFIED and never read as 0', () => {
    const v = verifyDailySale(day({ easypaisa: null }));
    expect(v.verified).toBe(false);
    expect(v.easypaisa).toMatchObject({ counted: null, difference: null, status: 'missing' });
    expect(v.problems).toEqual(['Easypaisa not entered']);
    expect(verifyDailySale(day({ cash: null, easypaisa: null })).problems).toEqual(['Cash not entered', 'Easypaisa not entered']);
  });

  test('bank: required when the day took bank payments or one was entered, otherwise nothing to verify', () => {
    expect(verifyDailySale(day()).bank).toBeNull();
    expect(verifyDailySale(day({}, { autoBank: 3000 })).problems).toEqual(['Bank not entered']);
    expect(verifyDailySale(day({ bank: 3000 }, { autoBank: 3000 })).verified).toBe(true);
    expect(verifyDailySale(day({ bank: 2900 }, { autoBank: 3000 })).problems).toEqual(['Bank − Rs. 100']);
  });

  test('a saved record reads the database’s difference, not one re-derived here', () => {
    const r = { ...day({ cash: 10000 }), cashDifference: -0.5 };
    expect(verifyDailySale(r).cash).toMatchObject({ difference: -0.5, status: 'short' });
  });
});

describe('reconcileMethod (a count being typed)', () => {
  test('whole paisa: no float error, and 50 paisa is never rounded away', () => {
    expect(reconcileMethod('cash', 0.3, 0.1 + 0.2)).toMatchObject({ difference: 0, status: 'match' });
    expect(reconcileMethod('cash', 38737.5, '38737')).toMatchObject({ difference: -0.5, status: 'short' });
    expect(reconcileMethod('easypaisa', 1234.56, '1234.57')).toMatchObject({ difference: 0.01, status: 'over' });
  });

  test('empty or invalid input is "missing", never a match', () => {
    for (const typed of ['', '  ', 'abc', null, undefined]) expect(reconcileMethod('cash', 10000, typed).status).toBe('missing');
  });

  test('zero against zero matches; zero counted against takings is short', () => {
    expect(reconcileMethod('easypaisa', 0, '0').status).toBe('match');
    expect(reconcileMethod('easypaisa', 250, 0)).toMatchObject({ difference: -250, status: 'short' });
  });
});

describe('9. formatting', () => {
  test('zero, whole and decimal amounts, with a real minus sign', () => {
    expect(formatSignedRupees(0)).toBe('Rs. 0');
    expect(formatSignedRupees(-500)).toBe('− Rs. 500');
    expect(formatSignedRupees(200)).toBe('+ Rs. 200');
    expect(formatSignedRupees(-12500)).toBe('− Rs. 12,500');
    expect(formatSignedRupees(0.5)).toBe('+ Rs. 0.5');
    expect(formatSignedRupees(-1234.56)).toBe('− Rs. 1,234.56');
    expect(formatSignedRupees(0.001)).toBe('Rs. 0');
  });

  test('the method badge: signed amount, Rs. 0, or Not entered', () => {
    const { rerender } = render(<MethodDiffBadge recon={reconcileMethod('cash', 10000, 9500)} />);
    expect(screen.getByText('− Rs. 500')).toBeTruthy();
    rerender(<MethodDiffBadge recon={reconcileMethod('cash', 10000, 10000)} />);
    expect(screen.getByText('Rs. 0')).toBeTruthy();
    rerender(<MethodDiffBadge recon={reconcileMethod('cash', 10000, '')} />);
    expect(screen.getByText('Not entered')).toBeTruthy();
  });
});

describe('the View panel', () => {
  test('shows each method’s table amount, counted amount and difference together, and why it is not verified', () => {
    render(<ReconciliationPanel record={day({ cash: 9500 })} />);
    const cash = screen.getByTestId('recon-cash');
    expect(cash.textContent).toContain('Cash on Table');
    expect(cash.textContent).toContain('Rs. 10,000');
    expect(cash.textContent).toContain('Counted Cash');
    expect(cash.textContent).toContain('Rs. 9,500');
    expect(within(cash).getByText('− Rs. 500')).toBeTruthy();
    expect(within(screen.getByTestId('recon-easypaisa')).getByText('Rs. 0')).toBeTruthy();
    expect(screen.getByText('NOT VERIFIED')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Cash − Rs. 500');
  });

  test('re-states itself for another day or a re-read of the sales', () => {
    const { rerender } = render(<ReconciliationPanel record={day()} />);
    expect(screen.getByText('VERIFIED')).toBeTruthy();
    rerender(<ReconciliationPanel record={day({}, { autoEasypaisa: 5600 })} />);
    expect(screen.getByText('NOT VERIFIED')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Easypaisa − Rs. 600');
  });
});

describe('8. the feed dialog: figures typed until they match → VERIFIED', () => {
  const record = {
    ...day({ cash: null, easypaisa: null }),
    id: 'r1', branchId: 'b1', branchName: 'DHA Branch', businessDate: '2026-10-22', autoTotalSale: 20000,
    companySharePct: 75, companyShare: 15000, branchSharePct: 25, branchShare: 5000, autoCash: 12000,
    autoFoodpanda: 3000, autoOther: 0, autoStaff: 0, discount: 0, cashExpense: 2000, expenseTotal: 2000,
    orderCount: 40, generatedAt: '2026-10-22T15:00:00Z', fedBy: null, fedByName: null, fedAt: null,
    overallDifference: 0, paymentTotal: 20000, status: 'open', createdBy: null, createdByName: null,
    verifiedBy: null, verifiedByName: null, verifiedAt: null, lockedBy: null, lockedByName: null, lockedAt: null,
    amendedAt: null, createdAt: null, updatedAt: null,
  } as DailySaleRecord;

  test('NOT VERIFIED while empty or out, VERIFIED once both match', () => {
    render(<ManualFeedDialog open onOpenChange={() => {}} record={record} token="t" isAdmin={false} />);
    const live = () => screen.getByTestId('live-verification').textContent;
    expect(live()).toContain('NOT VERIFIED');
    expect(live()).toContain('Cash not entered');

    const [cash, easypaisa] = screen.getAllByPlaceholderText('Counted amount');
    fireEvent.change(cash!, { target: { value: '9500' } });
    fireEvent.change(easypaisa!, { target: { value: '5200' } });
    expect(screen.getByText('− Rs. 500')).toBeTruthy();
    expect(screen.getByText('+ Rs. 200')).toBeTruthy();
    expect(live()).toContain('Cash − Rs. 500 · Easypaisa + Rs. 200');

    fireEvent.change(cash!, { target: { value: '10000' } });
    fireEvent.change(easypaisa!, { target: { value: '5000' } });
    expect(live()).toContain('VERIFIED');
    expect(live()).not.toContain('NOT VERIFIED');
  });
});
