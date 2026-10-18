import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FilterConfig } from '@mb/shared';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { GenericBooleanFilter, GenericSelectFilter } from '../filters';

/**
 * The select filters' "All" choice, on a list whose status defaults to
 * pending — Finance → Cash Transfers. Picking All must mean every status: no
 * filter left in the state, nothing counted as active, the label "All" on the
 * trigger, and a URL that reloads to the same thing.
 */

const STATUS: FilterConfig = {
  key: 'status', label: 'Status', type: 'select', placement: 'bar',
  options: [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
  ],
};
const VOIDED: FilterConfig = { key: 'voided', label: 'Voided', type: 'boolean', placement: 'bar' };

function Board() {
  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'voided'],
    defaults: { filters: [{ key: 'status', op: 'eq', value: 'pending' }] },
  });
  return (
    <>
      <GenericSelectFilter config={STATUS} getFilter={list.getFilter} setFilter={list.setFilter} />
      <GenericBooleanFilter config={VOIDED} getFilter={list.getFilter} setFilter={list.setFilter} />
      <output data-testid="filters">{JSON.stringify(list.state.filters)}</output>
      <output data-testid="active">{list.activeFilters.length}</output>
    </>
  );
}

const trigger = (name: string) => screen.getByRole('combobox', { name });
const filters = () => JSON.parse(screen.getByTestId('filters').textContent ?? '[]');

/**
 * Open the list and choose. The pointerdown matters: Base UI takes a bare
 * click (jsdom's carries no pointer type) only on the highlighted item, and on
 * a defaulted select that is the current value, not the one being picked.
 */
async function pick(name: string, option: string) {
  fireEvent.click(trigger(name));
  const item = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
}

beforeEach(() => window.history.replaceState(null, '', '/finance/cash-transfers'));
afterEach(cleanup);

describe('GenericSelectFilter on a defaulted key', () => {
  test('the trigger shows the default option by its label, not its value', () => {
    render(<Board />);
    expect(within(trigger('Status')).getByText('Pending')).toBeTruthy();
    expect(screen.getByTestId('active').textContent).toBe('0');
  });

  test('"All" removes the filter: no null left behind, nothing active, the label "All"', async () => {
    render(<Board />);
    await pick('Status', 'All');
    expect(filters()).toEqual([]);
    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(trigger('Status').textContent).toContain('All');
    expect(trigger('Status').textContent).not.toContain('__all__');
    expect(window.location.search).toBe('?status=');
  });

  test('"All" survives a reload instead of snapping back to pending', async () => {
    const { unmount } = render(<Board />);
    await pick('Status', 'All');
    unmount();
    render(<Board />);
    expect(filters()).toEqual([]);
    expect(trigger('Status').textContent).toContain('All');
  });

  test('another status is a filter of its own, shown by its label', async () => {
    render(<Board />);
    await pick('Status', 'Approved');
    expect(filters()).toEqual([{ key: 'status', op: 'eq', value: 'approved' }]);
    expect(screen.getByTestId('active').textContent).toBe('1');
    expect(trigger('Status').textContent).toContain('Approved');
    expect(window.location.search).toBe('?status=approved');
  });
});

describe('GenericBooleanFilter', () => {
  test('"All" after a choice removes the filter rather than storing null', async () => {
    render(<Board />);
    await pick('Voided', 'Yes');
    expect(filters()).toContainEqual({ key: 'voided', op: 'eq', value: 'true' });
    expect(trigger('Voided').textContent).toContain('Yes');
    await pick('Voided', 'All');
    expect(filters()).toEqual([{ key: 'status', op: 'eq', value: 'pending' }]);
    expect(trigger('Voided').textContent).toContain('All');
  });
});
