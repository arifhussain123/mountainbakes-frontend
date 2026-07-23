export const APP_NAME = 'Mountain Bakes ERP';
export const COMPANY_NAME = 'Mountain Bakes';
export const VERSION = '1.0.0';
export const SUPPORT_EMAIL = 'support@mountainbakes.pk';

export const PAGINATION_LIMIT = 20;
export const SEARCH_DEBOUNCE_MS = 300;
export const TOKEN_REFRESH_INTERVAL_MS = 55 * 60 * 1000; // 55 minutes

export const MAX_FILE_SIZE_MB = 5;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;

export const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'] as const;

// Branch retail payment methods (replaces legacy cash/card/online).
export const PAYMENT_METHODS = ['cash', 'easypaisa', 'foodpanda', 'bank_account'] as const;
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  easypaisa: 'Easypaisa',
  foodpanda: 'Foodpanda',
  bank_account: 'Bank Account',
  // legacy values that may still exist on old orders
  card: 'Card',
  online: 'Online',
};
