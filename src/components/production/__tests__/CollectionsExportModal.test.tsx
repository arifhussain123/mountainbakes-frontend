import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { apiCall } from '@/utils/api';
import { CollectionsExportModal } from '../CollectionsExportModal';

/**
 * Production Orders → Export Collections opens on the month to date, by
 * request date: the 1st of the current month through today.
 */

vi.mock('@/utils/api', () => ({ apiCall: vi.fn() }));
vi.mock('@/utils/saveBlob', () => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/queries', () => ({ useBranches: () => ({ data: [] }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.mocked(apiCall).mockReset().mockResolvedValue(new Blob(['PK']));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const dates = () => (screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/) as HTMLInputElement[]).map((i) => i.value);

describe('CollectionsExportModal', () => {
  test('opens on the 1st of the month through today, and exports that window', async () => {
    vi.setSystemTime(new Date('2026-10-25T07:00:00Z')); // 25 Oct, midday in Karachi
    render(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    expect(dates()).toEqual(['2026-10-01', '2026-10-25']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export Excel/ }));
    });
    expect(vi.mocked(apiCall).mock.calls[0]![0]).toBe(
      '/api/production-reports/export?report=collections&from=2026-10-01&to=2026-10-25&type=excel',
    );
  });

  test('in a new month it starts from that month\'s 1st', () => {
    vi.setSystemTime(new Date('2026-11-03T07:00:00Z'));
    render(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    expect(dates()).toEqual(['2026-11-01', '2026-11-03']);
  });

  test('reopening after the month changed resets to the new month', () => {
    vi.setSystemTime(new Date('2026-10-31T07:00:00Z'));
    const view = render(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    expect(dates()).toEqual(['2026-10-01', '2026-10-31']);
    view.rerender(<CollectionsExportModal open={false} onOpenChange={vi.fn()} token="t" />);
    vi.setSystemTime(new Date('2026-11-01T07:00:00Z'));
    view.rerender(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    expect(dates()).toEqual(['2026-11-01', '2026-11-01']);
  });

  test('From can be picked, so a previous month can be checked', async () => {
    vi.setSystemTime(new Date('2026-10-25T07:00:00Z'));
    render(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    const [fromInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/) as HTMLInputElement[];
    expect(fromInput!.disabled).toBe(false);
    fireEvent.change(fromInput!, { target: { value: '2026-09-01' } });
    expect(dates()).toEqual(['2026-09-01', '2026-10-25']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export Excel/ }));
    });
    expect(vi.mocked(apiCall).mock.calls[0]![0]).toBe(
      '/api/production-reports/export?report=collections&from=2026-09-01&to=2026-10-25&type=excel',
    );
  });

  test('a To before From moves From to the 1st of To\'s month', () => {
    vi.setSystemTime(new Date('2026-10-25T07:00:00Z'));
    render(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    const [, toInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/) as HTMLInputElement[];
    fireEvent.change(toInput!, { target: { value: '2026-09-14' } });
    expect(dates()).toEqual(['2026-09-01', '2026-09-14']);
  });

  test('a From after To moves To up to it', () => {
    vi.setSystemTime(new Date('2026-10-25T07:00:00Z'));
    render(<CollectionsExportModal open onOpenChange={vi.fn()} token="t" />);
    const [fromInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/) as HTMLInputElement[];
    fireEvent.change(fromInput!, { target: { value: '2026-10-28' } });
    expect(dates()).toEqual(['2026-10-28', '2026-10-28']);
  });
});
