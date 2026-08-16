export const APP_NAME = 'Mountain Bakes ERP';
export const COMPANY_NAME = 'Mountain Bakes';

export const MAX_FILE_SIZE_MB = 5;

// Branch retail payment methods (replaces legacy cash/card/online).
export const PAYMENT_METHODS = ['cash', 'easypaisa', 'foodpanda', 'bank_account'] as const;

/**
 * The production counter's list. 'staff' is an UNPAID sale — it takes no money, is
 * excluded from every revenue total, and requires a comment. It is offered here
 * only: PAYMENT_METHODS above stays as-is so branch sales cannot select it, and
 * /api/orders/pos rejects it server-side.
 */
export const PRODUCTION_SALE_PAYMENT_METHODS = [...PAYMENT_METHODS, 'staff'] as const;

/** Payment method that collects nothing — drives the "no cash tendered" UI. */
export const UNPAID_PAYMENT_METHOD = 'staff';

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  easypaisa: 'Easypaisa',
  foodpanda: 'Foodpanda',
  bank_account: 'Bank Account',
  staff: 'Staff',
  // legacy values that may still exist on old orders
  card: 'Card',
  online: 'Online',
};
