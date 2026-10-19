import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Attachment, ProductionReturn } from '@mb/shared';
import { ReturnPhoto } from '../ReturnPhoto';

/**
 * The photo shown with a return, wherever a return is listed: each line its own
 * picture, and an older return's one shared photo labelled as exactly that.
 */

afterEach(cleanup);

const photo = { id: 'a1', url: 'https://img/a1', sizeBytes: 2048 } as Attachment;
const row = (o: Partial<ProductionReturn> = {}) =>
  ({
    id: 'r1',
    productName: 'Classic Brownie',
    qty: 3,
    branchName: 'Mountain Bakes Gulberg',
    date: '2026-10-20',
    createdAt: '2026-10-20T10:00:00Z',
    reason: '',
    photo,
    ...o,
  }) as ProductionReturn;

describe('ReturnPhoto', () => {
  test("a per-line photo is named for its product, with no shared-photo note", () => {
    render(<ReturnPhoto row={row()} />);
    expect(screen.getByRole('img', { name: 'Photo of returned Classic Brownie' })).toBeTruthy();
    expect(screen.queryByText('One photo for all items (older return)')).toBeNull();
  });

  test('a legacy return says its one photo covers every item, beside the thumbnail and in the viewer', () => {
    render(<ReturnPhoto row={row({ legacySinglePhoto: true })} size="sm" />);
    expect(screen.getAllByText('One photo for all items (older return)')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /view photo of the whole return/i }));
    expect(screen.getAllByText('One photo for all items (older return)')).toHaveLength(2);
  });

  test('no photo renders a dash', () => {
    render(<ReturnPhoto row={row({ photo: null })} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});
