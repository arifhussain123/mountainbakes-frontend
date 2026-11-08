import { describe, expect, it } from 'vitest';
import type { StockRow } from '@mb/shared';
import { stockBalanceTone, stockCardFigures } from './stockCardFigures';

const row = (o: Partial<StockRow> = {}): StockRow => ({
  productId: 'p1',
  stockCode: 'STK-000001',
  productName: 'Cream Puff',
  isActive: true,
  opening: 0,
  newQty: 0,
  sold: 0,
  returned: 0,
  adjustment: 0,
  balance: 0,
  ...o,
}) as StockRow;

describe('stockCardFigures', () => {
  it('keeps the seven columns in the fixed order', () => {
    expect(stockCardFigures(row(), 0).map((f) => f.label)).toEqual([
      'Opening Stock', 'New Stock', 'Sold', 'Return', 'Adjust', 'Waiting', 'Expected',
    ]);
  });

  it('shows the row’s own figures, signed like the table, with Expected = balance + waiting', () => {
    // 20 + 10 - 6 - 1 + 2 = 25
    const f = stockCardFigures(row({ opening: 20, newQty: 10, sold: 6, returned: 1, adjustment: 2, balance: 25 }), 4);
    expect(f.map((x) => x.value)).toEqual(['20', '+10', '-6', '-1', '+2', '+4', '29']);
    expect(f.map((x) => x.tone)).toEqual(['neutral', 'positive', 'negative', 'negative', 'positive', 'positive', 'neutral']);
  });

  it('reads zero as a plain neutral "0"', () => {
    const f = stockCardFigures(row({ opening: 5, balance: 5 }), 0);
    expect(f.slice(1, 6).map((x) => [x.value, x.tone])).toEqual(Array(5).fill(['0', 'neutral']));
  });

  it('shows "—" for Waiting and Expected on a past day or while orders load — never a guessed 0', () => {
    for (const w of ['not-today', 'loading'] as const) {
      const f = stockCardFigures(row({ balance: 7 }), w);
      expect(f[5]).toMatchObject({ value: '—', tone: 'neutral' });
      expect(f[6]).toMatchObject({ value: '—', tone: 'neutral' });
    }
  });

  it('flags negatives red', () => {
    const f = stockCardFigures(row({ opening: -2, adjustment: -3, balance: -5 }), 0);
    expect(f[0].tone).toBe('negative');
    expect(f[4]).toMatchObject({ value: '-3', tone: 'negative' });
    expect(f[6]).toMatchObject({ value: '-5', tone: 'negative' });
    expect(stockBalanceTone(-5)).toBe('negative');
    expect(stockBalanceTone(3)).toBe('neutral');
  });
});
