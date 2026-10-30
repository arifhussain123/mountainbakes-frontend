import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { useDemandRecord } from '@/lib/finance';
import { BranchDemandRecordPage, DemandRecordPage } from '../DemandRecordPage';

/**
 * Branch → Demand Record shows one month to date: From is the 1st of the To
 * date's month and cannot be picked. Finance → Demand Record keeps both dates
 * free (and open to start with).
 */

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't', user: { id: 'u', role: 'branch' } }) }));
vi.mock('@/lib/queries', () => ({ useBranches: () => ({ data: [] }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../finance-ui', async (orig) => ({
  ...(await orig<typeof import('../finance-ui')>()),
  useFinanceAbilities: () => ({ canCreate: false, canApprove: false, canManage: false }),
}));
vi.mock('@/lib/finance', async (orig) => ({
  ...(await orig<typeof import('@/lib/finance')>()),
  useDemandRecordSettings: () => ({ data: { startDate: '2026-10-01' } }),
  useDemandRecord: vi.fn(() => ({ data: undefined, isError: false })),
  useFinanceMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T07:00:00Z')); // 25 Oct, midday in Karachi
  vi.mocked(useDemandRecord).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The dialogs on the page read with React Query (only once opened).
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const lastFilters = () => vi.mocked(useDemandRecord).mock.calls.at(-1)![0];
const dateInputs = () => Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];

describe('Demand Record dates', () => {
  test('a branch opens on the 1st of the month through today, From locked', () => {
    render(<BranchDemandRecordPage />);
    const [fromInput, toInput] = dateInputs();
    expect([fromInput!.value, toInput!.value]).toEqual(['2026-10-01', '2026-10-25']);
    expect(fromInput!.disabled).toBe(true);
    expect(lastFilters()).toMatchObject({ from: '2026-10-01', to: '2026-10-25' });
  });

  test('a branch picking an earlier To sees that month from its 1st', () => {
    render(<BranchDemandRecordPage />);
    fireEvent.change(dateInputs()[1]!, { target: { value: '2026-09-17' } });
    expect(dateInputs()[0]!.value).toBe('2026-09-01');
    expect(lastFilters()).toMatchObject({ from: '2026-09-01', to: '2026-09-17' });
    // Clear goes back to this month to date.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastFilters()).toMatchObject({ from: '2026-10-01', to: '2026-10-25' });
  });

  test('Finance keeps both dates free and open to start with', () => {
    render(<DemandRecordPage />);
    const [fromInput, toInput] = dateInputs();
    expect([fromInput!.value, toInput!.value]).toEqual(['', '']);
    expect(fromInput!.disabled).toBe(false);
    expect(lastFilters()).toMatchObject({ from: undefined, to: undefined });
    fireEvent.change(fromInput!, { target: { value: '2026-10-05' } });
    expect(lastFilters()).toMatchObject({ from: '2026-10-05', to: undefined });
  });
});
