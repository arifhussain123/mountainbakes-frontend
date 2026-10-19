import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BranchSummaryRow, CurrentStockRow } from '@mb/shared';
import { BranchGroupedBars, StockBars, wrapBranchName } from '../charts';

/**
 * Branch-wise summary and Current stock are drawn as upright columns, names
 * along the bottom. jsdom has no layout, so Recharts' responsive container
 * draws nothing here; what is pinned is the wrapping rule and the sideways
 * scroll box each chart sits in so a phone never squeezes or clips the names.
 */

// jsdom has no ResizeObserver, which Recharts' ResponsiveContainer needs to mount.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => cleanup());

describe('wrapBranchName', () => {
  test('a short name stays on one line', () => {
    expect(wrapBranchName('Alabad Branch')).toEqual(['Alabad Branch']);
  });

  test('a long name breaks at a word, never mid-word', () => {
    expect(wrapBranchName('Committee Chowk Branch')).toEqual(['Committee', 'Chowk Branch']);
    expect(wrapBranchName('Commercial Market Branch')).toEqual(['Commercial', 'Market Branch']);
  });

  test('never more than two lines; an over-long rest ends in an ellipsis', () => {
    const lines = wrapBranchName('Laziza Desert Co Branch Extension Wing');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Laziza Desert');
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(lines[1]!.length).toBeLessThanOrEqual(13);
  });

  test('a single word longer than a line is kept whole on its own line', () => {
    expect(wrapBranchName('Supercalifragilistic')).toEqual(['Supercalifragilistic']);
  });
});

const branch = (i: number): BranchSummaryRow =>
  ({ branchId: `b${i}`, branchName: `Branch ${i}`, demanded: 100 - i, delivered: 90 - i, returned: i, fulfilment: 90 } as unknown as BranchSummaryRow);
const product = (i: number): CurrentStockRow =>
  ({ productId: `p${i}`, productName: `Product ${i}`, production: 10, branch: 5, total: 15, state: 'ok' } as unknown as CurrentStockRow);

describe('column charts scroll sideways inside their own box', () => {
  test('Branch-wise: the inner width grows with the number of branches', () => {
    render(<BranchGroupedBars rows={Array.from({ length: 8 }, (_, i) => branch(i))} selectedId={null} onSelect={() => {}} />);
    const box = screen.getByTestId('branch-grouped-columns');
    expect(box.className).toContain('overflow-x-auto');
    expect(box.className).toContain('[contain:inline-size]');
    expect((box.firstElementChild as HTMLElement).style.minWidth).toBe(`${8 * 84 + 48}px`);
  });

  test('Current stock: the inner width grows with the number of products', () => {
    render(<StockBars rows={Array.from({ length: 25 }, (_, i) => product(i))} />);
    const box = screen.getByTestId('stock-columns');
    expect(box.className).toContain('overflow-x-auto');
    expect((box.firstElementChild as HTMLElement).style.minWidth).toBe(`${25 * 46 + 48}px`);
  });
});
