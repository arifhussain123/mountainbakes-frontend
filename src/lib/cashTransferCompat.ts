import type { CashTransfer } from '@mb/shared';

/**
 * A cash transfer as every screen may assume it: the four money figures
 * (migration 121) present and numeric.
 *
 * An API that predates the channel columns sends `amount` + `paymentMethod`
 * and nothing else, and the screens call `formatCurrency(t.cashAmount)` —
 * undefined there threw and blanked the whole Cash Deposits page when this
 * frontend went live ahead of its backend. The one method becomes the one
 * channel, exactly as migration 121 backfills the stored rows, so both sides
 * of a deploy read a deposit the same way.
 */
export function normalizeCashTransfer(t: CashTransfer): CashTransfer {
  const raw = t as Partial<CashTransfer> & CashTransfer;
  const amount = Number(raw.amount ?? 0);
  const has = raw.cashAmount != null || raw.easypaisaAmount != null || raw.bankAmount != null;
  const legacy = (m: string) => (!has && raw.paymentMethod === m ? amount : 0);
  return {
    ...t,
    amount,
    cashAmount: has ? Number(raw.cashAmount ?? 0) : legacy('cash'),
    easypaisaAmount: has ? Number(raw.easypaisaAmount ?? 0) : legacy('easypaisa'),
    bankAmount: has ? Number(raw.bankAmount ?? 0) : legacy('bank_account'),
    fuelCharges: Number(raw.fuelCharges ?? 0),
    attachments: raw.attachments ?? [],
  };
}

export function normalizeCashTransferList<T extends { transfers: CashTransfer[] }>(res: T): T {
  return { ...res, transfers: (res.transfers ?? []).map(normalizeCashTransfer) };
}
