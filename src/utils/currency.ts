export const CURRENCY = 'PKR';
export const CURRENCY_SYMBOL = 'Rs.';
export const CURRENCY_LOCALE = 'en-PK';

export function formatCurrency(amount: number): string {
  return `${CURRENCY_SYMBOL} ${amount.toLocaleString(CURRENCY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function parseCurrency(value: string): number {
  return parseFloat(value.replace(/[^0-9.-]/g, '')) || 0;
}

export function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `${CURRENCY_SYMBOL} ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${CURRENCY_SYMBOL} ${(amount / 1_000).toFixed(1)}K`;
  return formatCurrency(amount);
}
