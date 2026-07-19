// The chats stream now lives in a single provider (mounted once in the dashboard
// layout) instead of a per-component listener. This module preserves the original
// `@/hooks/useChats` import path used across the app.
export { useChats } from '@/providers/RealtimeProvider';
