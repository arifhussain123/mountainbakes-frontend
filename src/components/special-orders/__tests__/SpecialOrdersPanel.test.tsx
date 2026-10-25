import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SpecialOrder, SpecialOrderStatus } from '@mb/shared';
import { useSpecialOrders } from '@/lib/queries';
import { SpecialOrdersPanel } from '../SpecialOrdersPanel';

/**
 * Special Orders on the Orders page: an order is listed until the branch
 * verifies it — verification books it into the branch's stock — and then it
 * is gone from the page, for the branch and for Production alike.
 */

vi.mock('@/lib/queries', () => ({
  useSpecialOrders: vi.fn(),
  usePrepareSpecialOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifySpecialOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveSpecialOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const order = (orderNumber: string, status: SpecialOrderStatus): SpecialOrder => ({
  id: orderNumber,
  orderNumber,
  branchId: 'b1',
  branchName: 'Gulberg',
  date: '2026-10-25',
  requiredDate: null,
  status,
  items: [{
    id: `${orderNumber}-i`, itemName: 'Birthday cake', qty: 1, preparedQty: status === 'pending' ? null : 1,
    verifiedQty: status === 'approved' ? 1 : null, amount: 2500, description: '', lineNo: 1, productId: 'p1',
    requestPhotos: [], stockMovementId: null, stockTransactionNo: null,
  }],
  totalAmount: 2500,
  verificationPhotos: [],
  createdBy: null, createdByName: null, submittedAt: '2026-10-25T05:00:00Z',
  preparedBy: null, preparedByName: null, preparedAt: null,
  verifiedBy: null, verifiedByName: null, verifiedAt: null,
  approvedBy: null, approvedByName: null, approvedAt: null, stockAddedAt: null,
});

const setOrders = (orders: SpecialOrder[]) =>
  vi.mocked(useSpecialOrders).mockReturnValue({ data: orders } as never);

beforeEach(() => vi.mocked(useSpecialOrders).mockReset());
afterEach(cleanup);

describe('SpecialOrdersPanel', () => {
  test('the branch sees the order waiting for it, and not one it has already verified', () => {
    setOrders([order('SO-000002', 'awaiting_verification'), order('SO-000001', 'approved')]);
    render(<SpecialOrdersPanel mode="branch" token="t" />);
    expect(screen.getAllByText('SO-000002').length).toBeGreaterThan(0);
    expect(screen.queryByText('SO-000001')).toBeNull();
    expect(screen.queryByText(/Verified & approved in the last 7 days/)).toBeNull();
  });

  test('once every order is verified, the panel is gone from the page', () => {
    setOrders([order('SO-000001', 'approved'), order('SO-000003', 'approved')]);
    const { container } = render(<SpecialOrdersPanel mode="branch" token="t" />);
    expect(container.innerHTML).toBe('');
  });

  test('Production stops seeing an order once the branch has verified it', () => {
    setOrders([order('SO-000004', 'pending'), order('SO-000001', 'approved')]);
    render(<SpecialOrdersPanel mode="production" token="t" />);
    expect(screen.getAllByText('SO-000004').length).toBeGreaterThan(0);
    expect(screen.queryByText('SO-000001')).toBeNull();
  });
});
