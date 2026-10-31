import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CashTransfer } from '@mb/shared';
import { toast } from 'sonner';
import { useFinanceMutation } from '@/lib/finance';
import { qk } from '@/lib/queryKeys';
import { ForwardCashTransferDialog } from '../CashTransferDecisionDialogs';

/**
 * Submit for Approval is instant: the dialog closes and the row moves on the
 * click, before the server answers; a refusal puts the row back.
 */

vi.mock('@/lib/finance', () => ({ useFinanceMutation: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const transfer = {
  id: 'ct1',
  transferNo: 'CT-0001',
  branchName: 'Mountain Bakes Gulberg',
  status: 'pending',
  forwardedAt: null,
  amount: 1000,
  cashAmount: 1000,
  easypaisaAmount: 0,
  bankAmount: 0,
  fuelCharges: 0,
} as unknown as CashTransfer;
const other = { ...transfer, id: 'ct2', transferNo: 'CT-0002' } as CashTransfer;
const listKey = qk.financeCashTransfers({ limit: 25 });

let mutateAsync: ReturnType<typeof vi.fn>;
let settle: { resolve: (v: unknown) => void; reject: (e: unknown) => void };

beforeEach(() => {
  mutateAsync = vi.fn(() => new Promise((resolve, reject) => (settle = { resolve, reject })));
  vi.mocked(useFinanceMutation).mockReturnValue({ mutateAsync, isPending: true } as never);
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

function setup() {
  const client = new QueryClient();
  client.setQueryData(listKey, { transfers: [transfer, other], total: 2 });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ForwardCashTransferDialog transfer={transfer} onClose={onClose} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
  const rows = () => client.getQueryData<{ transfers: CashTransfer[] }>(listKey)!.transfers;
  return { onClose, rows };
}

describe('ForwardCashTransferDialog', () => {
  test('closes and moves the row before the server answers', () => {
    const { onClose, rows } = setup();
    expect(mutateAsync).toHaveBeenCalledWith({ path: '/api/finance/cash-transfers/ct1/forward', method: 'PUT' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('CT-0001 submitted for Finance Admin approval');
    expect(rows()[0]!.forwardedAt).toEqual(expect.any(String));
    expect(rows()[1]!.forwardedAt).toBeNull();
  });

  test('a refusal puts the row back and shows the server sentence', async () => {
    const { rows } = setup();
    settle.reject(new Error('CT-0001 has already been submitted for approval.'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('CT-0001 has already been submitted for approval.'));
    expect(rows()[0]!.forwardedAt).toBeNull();
  });

  test('the button is not held by a submit still in flight', () => {
    setup();
    expect((screen.getByRole('button', { name: 'Submit for Approval' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
