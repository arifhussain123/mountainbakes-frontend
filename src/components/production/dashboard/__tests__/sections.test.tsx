import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  buildBranchSummary,
  buildCurrentStock,
  buildReceivedDemand,
  buildRepairedStock,
  buildReturnStock,
  dashboardWindow,
} from '@mb/shared';
import { useProductionDashboardSection } from '@/lib/queries';
import { ReceivedDemandSection } from '../ReceivedDemandSection';
import { BranchSummarySection } from '../BranchSummarySection';
import { RepairedStockSection } from '../RepairedStockSection';
import { ReturnStockSection } from '../ReturnStockSection';
import { CurrentStockSection } from '../CurrentStockSection';
import { SectionBoundary } from '../parts';
import { labelledIndexes } from '../format';

/**
 * Each section's empty and error states, and that one section failing leaves
 * the others standing. The data hook is replaced; the empty payloads are made
 * by the same shared builders the API uses, so their shape cannot drift.
 */

vi.mock('@/lib/queries', () => ({ useProductionDashboardSection: vi.fn() }));
const useSection = vi.mocked(useProductionDashboardSection);

const AT = '2026-10-18T00:00:00.000Z';
const WIN = dashboardWindow('week', '2026-10-14');
const EMPTY = {
  'received-demand': buildReceivedDemand(WIN, 'day', [], [], [], AT),
  'branch-summary': buildBranchSummary(WIN, 'day', [], [], AT),
  'repaired-stock': buildRepairedStock(WIN, 'day', [], [], [], AT),
  'return-stock': buildReturnStock(WIN, 'day', [], [], [], [], 0, AT),
  'current-stock': buildCurrentStock([], 5, null, AT),
} as const;

type Section = keyof typeof EMPTY;

function state(over: Partial<{ data: unknown; isError: boolean; error: unknown; isLoading: boolean }> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
    ...over,
  };
}

/** Answers each section with its own state; anything not listed is empty. */
function answer(states: Partial<Record<Section, ReturnType<typeof state>>>) {
  useSection.mockImplementation(((section: Section) => states[section] ?? state({ data: EMPTY[section] })) as never);
}

const props = { token: 't', period: 'week' as const, branchId: null, scope: 'All branches', periodName: 'this week', versus: 'the same days of last week' };

const SECTIONS: { name: Section; title: string; empty: string; render: () => React.ReactElement }[] = [
  { name: 'received-demand', title: 'Received demand', empty: 'No demand received this week', render: () => <ReceivedDemandSection {...props} /> },
  {
    name: 'branch-summary', title: 'Branch-wise summary', empty: 'No active branches',
    render: () => <BranchSummarySection token="t" period="week" periodName="this week" versus="x" selectedId={null} onSelect={() => {}} />,
  },
  { name: 'repaired-stock', title: 'Repaired stock', empty: 'No returns this week, so nothing to repair', render: () => <RepairedStockSection {...props} /> },
  { name: 'return-stock', title: 'Return stock', empty: 'No returns this week', render: () => <ReturnStockSection {...props} /> },
  { name: 'current-stock', title: 'Current stock', empty: 'No active products', render: () => <CurrentStockSection token="t" period="week" branchId={null} scope="All branches" /> },
];

afterEach(() => {
  cleanup();
  useSection.mockReset();
});

describe.each(SECTIONS)('$title', (s) => {
  test('empty: says so in words, and still shows its figures', () => {
    answer({});
    render(s.render());
    expect(screen.getByRole('heading', { name: s.title })).toBeTruthy();
    expect(screen.getByText(s.empty)).toBeTruthy();
    expect(screen.queryByRole('figure')).toBeNull();
  });

  test('error: names the failure and retries on its own', () => {
    const failed = state({ isError: true, error: new Error('Request failed with 502 Bad Gateway') });
    answer({ [s.name]: failed });
    render(s.render());
    expect(screen.getByRole('alert').textContent).toContain('This section could not be loaded');
    expect(screen.getByText('Request failed with 502 Bad Gateway')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.refetch).toHaveBeenCalledTimes(1);
  });

  test('a failed refresh keeps the last figures on screen', () => {
    answer({ [s.name]: state({ data: EMPTY[s.name], isError: true, error: new Error('offline') }) });
    render(s.render());
    expect(screen.getByRole('status').textContent).toContain('the refresh failed');
    expect(screen.getByText(s.empty)).toBeTruthy();
  });

  test('loading: a skeleton, no figures yet', () => {
    answer({ [s.name]: state({ isLoading: true }) });
    const { container } = render(s.render());
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(s.empty)).toBeNull();
  });
});

describe('isolation', () => {
  test('one section failing leaves the others standing', () => {
    answer({ 'repaired-stock': state({ isError: true, error: new Error('boom') }) });
    render(<>{SECTIONS.map((s) => <div key={s.name}>{s.render()}</div>)}</>);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('No demand received this week')).toBeTruthy();
    expect(screen.getByText('No returns this week')).toBeTruthy();
    expect(screen.getByText('No active products')).toBeTruthy();
  });

  test('a section that throws while drawing is caught at its own boundary', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): React.ReactElement { throw new Error('bad data'); }
    answer({});
    render(
      <>
        <SectionBoundary title="Repaired stock"><Broken /></SectionBoundary>
        <ReturnStockSection {...props} />
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('This section could not be loaded');
    expect(screen.getByText('No returns this week')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('labelledIndexes', () => {
  test('the peak and the latest point, never a zero', () => {
    expect([...labelledIndexes([3, 9, 2, 5])].sort()).toEqual([1, 3]);
    expect([...labelledIndexes([0, 0, 0])]).toEqual([]);
    expect([...labelledIndexes([4, 2, 0])]).toEqual([0]);
    expect([...labelledIndexes([1, 2, 7])]).toEqual([2]);
  });
});
