import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SummaryTotalCard, formatSummaryAmount } from '../SummaryTotalCard';

/**
 * The full-width total card Shop Expenses and Branch → Discounts share: label,
 * amount, the optional line under the label, and its loading and error states.
 */

afterEach(() => {
  cleanup();
});

describe('formatSummaryAmount', () => {
  test('the settings symbol straight before the grouped number, as Shop Expenses writes it', () => {
    expect(formatSummaryAmount(12200, 'Rs. ')).toBe('Rs. 12,200');
    expect(formatSummaryAmount(8750.5, 'Rs. ')).toBe('Rs. 8,750.5');
  });

  test('falls back to Rs. when settings have not loaded', () => {
    expect(formatSummaryAmount(0, undefined)).toBe('Rs.0');
    expect(formatSummaryAmount(95000, '')).toBe('Rs.95,000');
  });
});

describe('SummaryTotalCard', () => {
  test('shows the label, the amount and the line under the label', () => {
    render(<SummaryTotalCard data-testid="card" label="Total discount (since 2026-10-01)" amount="Rs. 12,200" secondaryText="17 claims approved" />);
    const card = screen.getByTestId('card');
    expect(card.textContent).toContain('Total discount (since 2026-10-01)');
    expect(card.textContent).toContain('Rs. 12,200');
    expect(card.textContent).toContain('17 claims approved');
  });

  test('no line under the label when none is given', () => {
    render(<SummaryTotalCard data-testid="card" label="Total (since 2026-10-01)" amount="Rs. 95,000" />);
    expect(screen.getByTestId('card').textContent).toBe('Total (since 2026-10-01)Rs. 95,000');
  });

  test('a skeleton instead of figures while loading, keeping the second line', () => {
    render(<SummaryTotalCard data-testid="card" label="Total" amount="Rs. 1" secondaryText="" loading />);
    const skeleton = screen.getByTestId('card-skeleton');
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(skeleton.textContent).toBe('');
    expect(skeleton.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(screen.queryByTestId('card')).toBeNull();
  });

  test('an error stays inside the card, with a retry, and no amount', () => {
    const onRetry = vi.fn();
    render(<SummaryTotalCard data-testid="card" label="Total" amount="Rs. 1" secondaryText="2 claims approved" error={{ message: 'Could not load it.', onRetry }} />);
    const card = screen.getByTestId('card');
    expect(screen.getByRole('alert').textContent).toContain('Could not load it.');
    expect(card.textContent).not.toContain('Rs. 1');
    expect(card.textContent).not.toContain('2 claims approved');
    expect(card.textContent).toContain('—');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('the retry is disabled while it runs', () => {
    render(<SummaryTotalCard label="Total" amount="" error={{ onRetry: () => {}, retrying: true }} />);
    expect((screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
