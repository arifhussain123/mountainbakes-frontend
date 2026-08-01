// Re-export API client so the rest of the app imports from @/utils/api
export { apiCall, ApiError } from '@/lib/api/client';

// The API base URL is resolved in exactly one place — lib/api/client.ts. A second
// copy lived here and drifted: it still described requests as being proxied to a
// co-located API, which stopped being true when the /api/* rewrite was removed.

// Common API endpoint paths
export const API_ENDPOINTS = {
  // Auth. These are paths on the EXPRESS API, not this origin — sign-in and
  // sign-out themselves go straight to Supabase from the browser.
  LOGIN: '/api/auth/login',

  // Settings
  SETTINGS: '/api/settings',

  // Core resources
  PRODUCTS: '/api/products',
  CATEGORIES: '/api/categories',
  ORDERS: '/api/orders',
  CUSTOMERS: '/api/customers',
  BRANCHES: '/api/branches',
  USERS: '/api/users',
  REPORTS: '/api/reports',
  NOTIFICATIONS: '/api/notifications',

  // Production
  PRODUCTION_QUEUE: '/api/production-queue',
} as const;
