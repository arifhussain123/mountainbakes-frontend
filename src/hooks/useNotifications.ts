// The notifications stream now lives in a single provider (mounted once in the
// dashboard layout) instead of a per-component listener. This module preserves
// the original `@/hooks/useNotifications` import path used across the app.
export { useNotifications } from '@/providers/RealtimeProvider';
