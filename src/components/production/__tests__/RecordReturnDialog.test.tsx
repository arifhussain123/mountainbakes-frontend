import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Branch, Product } from '@mb/shared';
import { useCreateReturn } from '@/lib/queries';
import { toast } from 'sonner';
import { RecordReturnDialog } from '../RecordReturnDialog';

/**
 * Production → Product Returns' "+ Record Return" dialog: it reaches the API
 * only with a complete form, once per submit however fast the clicks come, and
 * a refused save leaves the dialog open with what was typed.
 */

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('@/lib/queries', () => ({ useCreateReturn: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mutateAsync = vi.fn();
const branches = [
  { id: 'b1', name: 'Mountain Bakes Gulberg', isActive: true },
  { id: 'b2', name: 'Mountain Bakes Closed', isActive: false },
] as Branch[];
const products = [
  { id: 'p1', name: 'Bread', isActive: true },
  { id: 'p2', name: 'Retired Cake', isActive: false },
] as Product[];

beforeEach(() => {
  mutateAsync.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(useCreateReturn).mockReturnValue({ mutateAsync, isPending: false } as never);
});
afterEach(cleanup);

function renderDialog(onOpenChange = vi.fn()) {
  render(<RecordReturnDialog open onOpenChange={onOpenChange} branches={branches} products={products} />);
  return onOpenChange;
}

async function pick(trigger: string, option: string) {
  fireEvent.click(screen.getByLabelText(trigger));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

async function fillValid() {
  await pick('Branch', 'Mountain Bakes Gulberg');
  await pick('Product', 'Bread');
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Stale on arrival' } });
}

const submitButton = () => screen.getByRole('button', { name: 'Record Return' });

describe('RecordReturnDialog', () => {
  test('an empty submit names every missing field and sends nothing', async () => {
    renderDialog();
    fireEvent.click(submitButton());
    expect(await screen.findByText('Pick the branch the goods came from.')).toBeTruthy();
    expect(screen.getByText('Pick the product being returned.')).toBeTruthy();
    expect(screen.getByText('Enter a whole number of 1 or more.')).toBeTruthy();
    expect(screen.getByText('Say why it is coming back.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  test('offers active branches and products only', async () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText('Branch'));
    expect(await screen.findByRole('option', { name: 'Mountain Bakes Gulberg' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Mountain Bakes Closed' })).toBeNull();
  });

  test('a valid return is sent once, with the trimmed reason, and closes the dialog', async () => {
    let resolve!: (v: unknown) => void;
    mutateAsync.mockReturnValue(new Promise((r) => (resolve = r)));
    const onOpenChange = renderDialog();
    await fillValid();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Stale on arrival  ' } });

    // Three clicks before the first request settles.
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());
    await act(async () => resolve({ id: 'r1' }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ branchId: 'b1', productId: 'p1', qty: 4, reason: 'Stale on arrival' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });

  test('a refused save shows the API message and keeps the dialog and its values', async () => {
    mutateAsync.mockRejectedValue(new Error('Branch not found'));
    const onOpenChange = renderDialog();
    await fillValid();
    fireEvent.click(submitButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Branch not found'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('4');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
