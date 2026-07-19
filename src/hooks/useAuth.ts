// Auth state now lives in a single context provider (mounted once at the root)
// instead of a per-component listener. This module preserves the original
// `@/hooks/useAuth` import path used across the app.
export type { AuthUser } from '@/providers/AuthProvider';
export { useAuth } from '@/providers/AuthProvider';
