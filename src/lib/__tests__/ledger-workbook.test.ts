import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Daily Ledger's Excel button asks the server for the accounting workbook
 * and saves what comes back. The workbook's figures never pass through the
 * client: this only builds the request and names the file.
 */

const apiCall = vi.fn();
const saveBlob = vi.fn();
vi.mock('@/utils/api', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));
vi.mock('@/utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => saveBlob(...args) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't' }) }));

const { downloadLedgerWorkbook } = await import('../finance');

describe('downloadLedgerWorkbook', () => {
  beforeEach(() => {
    apiCall.mockReset();
    saveBlob.mockReset();
  });

  it('requests the workbook for the period and branch only, and saves it under the period', async () => {
    const blob = new Blob(['PK']);
    apiCall.mockResolvedValue(blob);
    await downloadLedgerWorkbook({ from: '2026-10-01', to: '2026-10-25', branchId: 'b-1' }, 'tok');
    expect(apiCall).toHaveBeenCalledWith(
      '/api/finance/reports/accounting-workbook?from=2026-10-01&to=2026-10-25&branchId=b-1',
      {},
      'tok',
    );
    expect(saveBlob).toHaveBeenCalledWith(blob, 'Mountain_Bakes_Daily_Ledger_2026-10-01_to_2026-10-25.xlsx');
  });

  it('names a single day by that day and leaves out an empty branch', async () => {
    apiCall.mockResolvedValue(new Blob(['PK']));
    await downloadLedgerWorkbook({ from: '2026-10-25', to: '2026-10-25' }, 'tok');
    expect(apiCall.mock.calls[0]![0]).toBe('/api/finance/reports/accounting-workbook?from=2026-10-25&to=2026-10-25');
    expect(saveBlob.mock.calls[0]![1]).toBe('Mountain_Bakes_Daily_Ledger_2026-10-25.xlsx');
  });

  it('passes a server error up so the page can show it, and saves nothing', async () => {
    apiCall.mockRejectedValue(new Error('Forbidden: your finance role may not view finance records.'));
    await expect(downloadLedgerWorkbook({ from: '2026-10-25' }, 'tok')).rejects.toThrow(/Forbidden/);
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
