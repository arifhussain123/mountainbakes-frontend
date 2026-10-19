import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Attachment, StockRow } from '@mb/shared';
import { toast } from 'sonner';
import { apiCall, ApiError } from '@/utils/api';
import { discardAttachment, uploadAttachmentWithProgress, type LocalPhoto } from '@/lib/attachments';
import { ReturnItemsModal } from '../ReturnItemsModal';

/**
 * Branch → Return Items: a separate photo for each returned product. Every line
 * uploads its own picture the moment it is taken; Save waits until every line
 * being returned has one stored, then sends each line with ITS photo id and an
 * Idempotency-Key. Photos that end up belonging to nothing are discarded.
 */

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/geofence/GeofenceGate', () => ({
  GeofenceGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  apiCall: vi.fn(),
}));
// Compression needs createImageBitmap + canvas, which jsdom has neither of;
// the network is stood in for so each upload can be settled by hand.
vi.mock('@/lib/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachments')>()),
  prepareReturnPhoto: vi.fn(
    async (source: Blob): Promise<LocalPhoto> => ({
      image: { blob: source, width: 10, height: 10 },
      previewUrl: `blob:preview-${(source as File).name}`,
      originalBytes: source.size,
    }),
  ),
  releaseLocalPhoto: vi.fn(),
  uploadAttachmentWithProgress: vi.fn(),
  discardAttachment: vi.fn(async () => {}),
}));
// The base-ui Combobox is a popup list that jsdom does not lay out; a native
// select drives the same props (items / value / onValueChange) the modal uses.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({
    items,
    value,
    onValueChange,
  }: {
    items: StockRow[];
    value: StockRow | null;
    onValueChange: (r: StockRow | null) => void;
  }) => (
    <select
      aria-label="Product"
      value={value?.productId ?? ''}
      onChange={(e) => onValueChange(items.find((i) => i.productId === e.target.value) ?? null)}
    >
      <option value="">—</option>
      {items.map((i) => (
        <option key={i.productId} value={i.productId}>
          {i.productName}
        </option>
      ))}
    </select>
  ),
  ComboboxContent: () => null,
  ComboboxEmpty: () => null,
  ComboboxInput: () => null,
  ComboboxItem: () => null,
  ComboboxList: () => null,
}));

const STOCK = [
  { productId: 'p1', productName: 'Bread', stockCode: 'STK-1', balance: 10 },
  { productId: 'p2', productName: 'Cake', stockCode: 'STK-2', balance: 5 },
] as StockRow[];

/** Each upload the modal starts, settled by the test. */
interface PendingUpload {
  signal: AbortSignal | undefined;
  onProgress: ((f: number) => void) | undefined;
  resolve: (a: Attachment) => void;
  reject: (e: unknown) => void;
}
let uploads: PendingUpload[] = [];

const attachment = (id: string) => ({ id, url: `https://img/${id}`, sizeBytes: 1000 }) as Attachment;

beforeEach(() => {
  uploads = [];
  vi.mocked(uploadAttachmentWithProgress).mockReset();
  vi.mocked(uploadAttachmentWithProgress).mockImplementation(
    (_entity, _image, _token, options = {}) =>
      new Promise<Attachment>((resolve, reject) => {
        uploads.push({ signal: options.signal, onProgress: options.onProgress, resolve, reject });
      }),
  );
  vi.mocked(discardAttachment).mockClear();
  vi.mocked(apiCall).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

function renderModal() {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(<ReturnItemsModal open onOpenChange={onOpenChange} rows={STOCK} branchName="Gulberg" onSaved={onSaved} />);
  return { onOpenChange, onSaved };
}

/** Two lines: 2 × Bread and 3 × Cake. */
function fillTwoLines() {
  fireEvent.change(screen.getAllByLabelText('Product')[0], { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText('Return quantity for Bread'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));
  fireEvent.change(screen.getAllByLabelText('Product')[1], { target: { value: 'p2' } });
  fireEvent.change(screen.getByLabelText('Return quantity for Cake'), { target: { value: '3' } });
}

/** Choose a picture for a line through its (hidden) gallery input. */
async function pickPhoto(product: string, fileName = `${product}.jpg`) {
  const before = uploads.length;
  const input = screen.getByLabelText(new RegExp(`^(Upload|Replace) file: photo of returned ${product}$`));
  fireEvent.change(input, { target: { files: [new File(['x'], fileName, { type: 'image/jpeg' })] } });
  await waitFor(() => expect(uploads.length).toBe(before + 1));
  return uploads[uploads.length - 1];
}

async function settle(upload: PendingUpload, id: string) {
  await act(async () => upload.resolve(attachment(id)));
}

const saveButton = () => screen.getByRole('button', { name: /Save Return/ });
const summary = () => screen.getByTestId('return-summary').textContent ?? '';

describe('ReturnItemsModal — a photo per returned product', () => {
  test('Save stays unavailable until BOTH lines have an uploaded photo; the footer counts them', async () => {
    renderModal();
    fillTwoLines();

    expect(summary()).toContain('Photos 0 of 2');
    expect(screen.getAllByText('Photo required')).toHaveLength(2);
    expect(saveButton().getAttribute('aria-disabled')).toBe('true');

    // Photographing a line starts its upload at once, with progress on that row.
    const bread = await pickPhoto('Bread');
    await act(async () => bread.onProgress?.(0.4));
    expect(screen.getByText('Uploading 40%')).toBeTruthy();
    // Uploading is not uploaded: still 0 of 2.
    expect(summary()).toContain('Photos 0 of 2');

    await settle(bread, 'att-1');
    expect(summary()).toContain('Photos 1 of 2');
    expect(screen.getAllByText('Photo required')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Photo of returned Bread' })).toBeTruthy();

    // Pressed anyway: nothing is sent, and the user is told which line is short.
    fireEvent.click(saveButton());
    expect(apiCall).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Add a photo of Cake before saving.');

    await settle(await pickPhoto('Cake'), 'att-2');
    expect(summary()).toContain('Photos 2 of 2');
    expect(saveButton().getAttribute('aria-disabled')).toBeNull();
  });

  test('the payload carries each line with its own photo, and an Idempotency-Key', async () => {
    vi.mocked(apiCall).mockResolvedValue({ ids: ['r1', 'r2'] });
    const { onOpenChange, onSaved } = renderModal();
    fillTwoLines();
    await settle(await pickPhoto('Bread'), 'att-1');
    await settle(await pickPhoto('Cake'), 'att-2');

    await act(async () => fireEvent.click(saveButton()));

    expect(apiCall).toHaveBeenCalledTimes(1);
    const [endpoint, init] = vi.mocked(apiCall).mock.calls[0];
    expect(endpoint).toBe('/api/stock/return');
    expect(JSON.parse(String(init?.body))).toEqual({
      items: [
        { productId: 'p1', qty: 2, attachmentId: 'att-1' },
        { productId: 'p2', qty: 3, attachmentId: 'att-2' },
      ],
      reason: '',
    });
    // No legacy one-photo-per-return field.
    expect(String(init?.body)).not.toContain('attachmentIds');
    const key = (init?.headers as Record<string, string>)['Idempotency-Key'];
    expect(key).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSaved).toHaveBeenCalled();
    // The saved photos are bound to the return — never discarded.
    expect(discardAttachment).not.toHaveBeenCalled();
  });

  test('a refused save keeps the photos, and a retry of the same return reuses its key', async () => {
    vi.mocked(apiCall).mockRejectedValueOnce(new ApiError('Only 5 Cake in stock', 409, []));
    renderModal();
    fillTwoLines();
    await settle(await pickPhoto('Bread'), 'att-1');
    await settle(await pickPhoto('Cake'), 'att-2');

    await act(async () => fireEvent.click(saveButton()));
    expect(toast.error).toHaveBeenCalledWith('Only 5 Cake in stock');
    expect(discardAttachment).not.toHaveBeenCalled();
    expect(summary()).toContain('Photos 2 of 2');

    vi.mocked(apiCall).mockResolvedValueOnce({ ids: ['r1', 'r2'] });
    await act(async () => fireEvent.click(saveButton()));
    const keys = vi.mocked(apiCall).mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
  });

  test('deleting a row discards its uploaded photo, and cancels one still uploading', async () => {
    renderModal();
    fillTwoLines();
    await settle(await pickPhoto('Bread'), 'att-1');
    const cake = await pickPhoto('Cake');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cake' }));
    expect(cake.signal?.aborted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bread' }));
    expect(discardAttachment).toHaveBeenCalledWith('att-1', 't');
    expect(summary()).toContain('Photos 0 of 0');
  });

  test('a retake replaces the photo and discards the one it replaced', async () => {
    vi.mocked(apiCall).mockResolvedValue({ ids: ['r1'] });
    renderModal();
    fireEvent.change(screen.getAllByLabelText('Product')[0], { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Return quantity for Bread'), { target: { value: '2' } });
    await settle(await pickPhoto('Bread', 'first.jpg'), 'att-1');

    // Once there is a photo the gallery button reads "Replace".
    const retake = await pickPhoto('Bread', 'second.jpg');
    expect(discardAttachment).toHaveBeenCalledWith('att-1', 't');
    await settle(retake, 'att-9');
    expect(
      (screen.getByRole('img', { name: 'Photo of returned Bread' }) as HTMLImageElement).getAttribute('src'),
    ).toBe('blob:preview-second.jpg');

    await act(async () => fireEvent.click(saveButton()));
    const body = JSON.parse(String(vi.mocked(apiCall).mock.calls[0][1]?.body));
    expect(body.items).toEqual([{ productId: 'p1', qty: 2, attachmentId: 'att-9' }]);
  });

  test('a failed upload offers Retry on that row only, and Retry sends the same picture again', async () => {
    renderModal();
    fillTwoLines();
    const bread = await pickPhoto('Bread');
    await settle(await pickPhoto('Cake'), 'att-2');
    await act(async () => bread.reject(new ApiError('Upload failed (HTTP 500)', 500)));

    const retries = screen.getAllByRole('button', { name: /^Retry/ });
    expect(retries).toHaveLength(1);
    expect(retries[0].getAttribute('aria-label')).toBe('Retry: Photo of returned Bread');
    expect(summary()).toContain('Photos 1 of 2');

    fireEvent.click(retries[0]);
    expect(uploadAttachmentWithProgress).toHaveBeenCalledTimes(3);
    const [, firstImage] = vi.mocked(uploadAttachmentWithProgress).mock.calls[0];
    const [, retriedImage] = vi.mocked(uploadAttachmentWithProgress).mock.calls[2];
    expect(retriedImage).toBe(firstImage);
    await settle(uploads[2], 'att-1');
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();
    expect(summary()).toContain('Photos 2 of 2');
  });

  test('photos the server can no longer use go back to Retry on their own lines', async () => {
    vi.mocked(apiCall).mockRejectedValueOnce(
      new ApiError('An attached photo is no longer available.', 409, {
        code: 'attachment_unavailable',
        attachmentIds: ['att-2'],
      }),
    );
    renderModal();
    fillTwoLines();
    await settle(await pickPhoto('Bread'), 'att-1');
    await settle(await pickPhoto('Cake'), 'att-2');

    await act(async () => fireEvent.click(saveButton()));
    expect(screen.getByRole('button', { name: 'Retry: Photo of returned Cake' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry: Photo of returned Bread' })).toBeNull();
    expect(summary()).toContain('Photos 1 of 2');
  });

  test('Cancel discards every photo the dialog staged', async () => {
    const { onOpenChange } = renderModal();
    fillTwoLines();
    await settle(await pickPhoto('Bread'), 'att-1');
    const cake = await pickPhoto('Cake');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(discardAttachment).toHaveBeenCalledWith('att-1', 't');
    expect(cake.signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // An upload that lands after the dialog closed belongs to nothing either.
    await settle(cake, 'att-late');
    expect(discardAttachment).toHaveBeenCalledWith('att-late', 't');
  });

  test('every line names its own photo control', () => {
    renderModal();
    fillTwoLines();
    const rows = document.querySelectorAll('[data-row-id]');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Photo required')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Photo required')).toBeTruthy();
  });
});
