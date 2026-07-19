// Re-export API client so the rest of the app imports from @/utils/api
export { apiCall, ApiError } from '@/lib/api/client';

// Same resolution as lib/api/client.ts: relative (same-origin, proxied to the
// co-located Express API) unless NEXT_PUBLIC_API_URL names an external API host.
export const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL || '').trim() ||
  (typeof window === 'undefined' ? `http://127.0.0.1:${process.env.API_PORT || '3001'}` : '');

// Common API endpoint paths
export const API_ENDPOINTS = {
  // Auth
  LOGIN: '/api/auth/login',
  LOGOUT: '/api/logout',

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
